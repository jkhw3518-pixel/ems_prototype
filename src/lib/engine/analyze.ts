import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { analysisResult, criteria, downtimeCause, downtimeEvent, equipment, moldProduction, reading, utilizationDaily } from "@/db/schema";
import { DAY_MINUTES, LINE_VOLTAGE, MIN_RUN_FOR_DAY, POWER_FACTOR } from "../constants";
import { dayEnd, dayStart } from "../time";
import { classify, detectSegments, round1, suggestCause, type ClassifyResult, type Segment } from "./core";

export type NonProdRun = { code: string; factory: string; runMinutes: number; avgCurrent: number; kwh: number };

export type ResultJson = {
  target: number;
  partial: boolean;
  missing: number;
  wholeDayStop: boolean;
  longestStop: number;
  capa12hr: number | null;
  mold: { inputQty: number; goodQty: number; theoretical: number; speedLoss: number; defect: number; yield: number | null } | null;
  nonProd: { avgCurrent: number; kwh: number } | null;
  crit: { stop: number; idle: number; duration: number };
};

type Prev = Pick<typeof downtimeEvent.$inferSelect, "cause" | "causeCode" | "causeSource" | "classifiedBy" | "classifiedAt" | "memo">;

/** 지정일 분석 실행 (§6.6). 기존 원인 분류는 동일 구간(설비·상태·시작분)에 이어 붙인다. */
export async function runAnalysis(db: DB, date: string) {
  const from = dayStart(date);
  const to = dayEnd(date);

  const equips = await db.select().from(equipment).where(eq(equipment.active, true)).orderBy(equipment.displayOrder);
  const crits = new Map((await db.select().from(criteria)).map((c) => [c.group, c]));
  const rows = await db
    .select({ e: reading.equipmentId, t: reading.recordedAt, v: reading.currentValue })
    .from(reading)
    .where(and(gte(reading.recordedAt, from), lt(reading.recordedAt, to)));

  const byEquip = new Map<number, (number | null)[]>();
  for (const r of rows) {
    const m = Math.floor((new Date(r.t).getTime() - from.getTime()) / 60_000);
    if (m < 0 || m >= DAY_MINUTES) continue;
    let arr = byEquip.get(r.e);
    if (!arr) byEquip.set(r.e, (arr = new Array(DAY_MINUTES).fill(null)));
    arr[m] = Number(r.v);
  }

  const molds = await db.select().from(moldProduction).where(eq(moldProduction.productionDate, date));
  const moldByEquip = new Map<number, typeof molds>();
  for (const m of molds) moldByEquip.set(m.equipmentId, [...(moldByEquip.get(m.equipmentId) ?? []), m]);
  const hasAnyMold = molds.length > 0;

  // 1) 상태 분류
  const classified: { e: (typeof equips)[number]; c: ClassifyResult; crit: { stop: number; idle: number; duration: number } }[] = [];
  for (const e of equips) {
    const raw = byEquip.get(e.id);
    if (!raw) continue;
    const cr = crits.get(e.group);
    const crit = cr
      ? { stop: Number(cr.stopThreshold), idle: Number(cr.idleThreshold), duration: cr.durationMin }
      : { stop: 5, idle: 50, duration: 5 };
    const c = classify(raw, crit);
    if (c.target < 60) continue; // 데이터 1시간 미만이면 분석 생략
    classified.push({ e, c, crit });
  }

  // 공장별 동시 정지 비율 (공통설비 추천용, 미가동 제외 설비는 분모에서 뺀다)
  const factoryDown = new Map<string, { down: number[]; total: number }>();
  for (const { e, c } of classified) {
    if (c.excluded) continue;
    let f = factoryDown.get(e.factory);
    if (!f) factoryDown.set(e.factory, (f = { down: new Array(DAY_MINUTES).fill(0), total: 0 }));
    f.total++;
    for (let i = 0; i < c.target; i++) if (c.states[i] !== "run") f.down[i]++;
  }

  // 기존 분류 보존
  const old = await db
    .select()
    .from(downtimeEvent)
    .where(eq(downtimeEvent.analysisDate, date));
  const prevMap = new Map<string, Prev>();
  for (const o of old) if (o.causeCode || o.memo) prevMap.set(`${o.equipmentId}:${o.state}:${o.startMinute}`, o);

  const causes = await db.select().from(downtimeCause);
  const plannedCodes = new Set(causes.filter((c) => c.isPlanned).map((c) => c.code));

  const resultRows: (typeof analysisResult.$inferInsert)[] = [];
  const eventRows: (typeof downtimeEvent.$inferInsert)[] = [];
  const nonProd: NonProdRun[] = [];

  for (const { e, c, crit } of classified) {
    const ml = moldByEquip.get(e.id) ?? [];
    const capa12 = ml.length ? Math.max(...ml.map((m) => Number(m.capa12hr ?? 0))) : null;
    const perMin = capa12 ? capa12 / 720 : 0;
    const inputQty = ml.reduce((a, m) => a + m.inputQty, 0);
    const goodQty = ml.reduce((a, m) => a + m.goodQty, 0);
    const defectRate = inputQty > 0 ? 1 - goodQty / inputQty : null;

    const segs: Segment[] = c.excluded ? [] : detectSegments(c);
    const fd = factoryDown.get(e.factory);
    for (const s of segs) {
      s.suggested = suggestCause(s, {
        hasMoldToday: ml.length > 0,
        defectRate,
        factoryDownRatio: (m) => (fd && fd.total >= 3 ? fd.down[m] / fd.total : 0),
      });
    }

    let planned = 0;
    for (const s of segs) {
      const p = prevMap.get(`${e.id}:${s.state}:${s.start}`);
      if (p?.causeCode && plannedCodes.has(p.causeCode)) planned += s.duration;
      eventRows.push({
        analysisDate: date,
        equipmentId: e.id,
        state: s.state,
        startMinute: s.start,
        endMinute: s.end,
        duration: s.duration,
        avgCurrent: s.avg,
        minCurrent: s.min,
        maxCurrent: s.max,
        lostUnits: perMin ? round1(s.duration * perMin) : null,
        tags: s.tags,
        suggestedCauseCode: s.suggested ?? null,
        cause: p?.cause ?? null,
        causeCode: p?.causeCode ?? null,
        causeSource: p?.causeSource ?? null,
        classifiedBy: p?.classifiedBy ?? null,
        classifiedAt: p?.classifiedAt ?? null,
        memo: p?.memo ?? null,
      });
    }

    const lost = c.excluded || !perMin ? null : round1((c.idle + c.stop) * perMin);
    const theoretical = Math.round(c.run * perMin);
    let np: ResultJson["nonProd"] = null;
    if (hasAnyMold && !c.excluded && ml.length === 0 && c.run > MIN_RUN_FOR_DAY) {
      const runVals = c.values.filter((_, i) => c.states[i] === "run");
      const avgA = runVals.reduce((a, b) => a + b, 0) / runVals.length;
      const kwh = (Math.sqrt(3) * LINE_VOLTAGE * avgA * POWER_FACTOR * (c.run / 60)) / 1000;
      np = { avgCurrent: round1(avgA), kwh: round1(kwh) };
      nonProd.push({ code: e.code, factory: e.factory, runMinutes: c.run, avgCurrent: np.avgCurrent, kwh: np.kwh });
    }

    const json: ResultJson = {
      target: c.target,
      partial: c.partial,
      missing: c.missing,
      wholeDayStop: c.wholeDayStop,
      longestStop: c.longestStop,
      capa12hr: capa12,
      mold: ml.length
        ? {
            inputQty,
            goodQty,
            theoretical,
            speedLoss: Math.max(0, theoretical - inputQty),
            defect: inputQty - goodQty,
            yield: inputQty ? goodQty / inputQty : null,
          }
        : null,
      nonProd: np,
      crit,
    };

    resultRows.push({
      analysisDate: date,
      factory: e.factory,
      equipmentId: e.id,
      status: c.states[c.target - 1] ?? "stop",
      minutes: c.target,
      runMinutes: c.run,
      idleMinutes: c.idle,
      stopMinutes: c.stop,
      plannedStopMinutes: planned,
      excluded: c.excluded,
      utilizationRate: c.target ? Number((c.run / c.target).toFixed(4)) : 0,
      lostUnits: lost,
      resultJson: json,
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(downtimeEvent).where(eq(downtimeEvent.analysisDate, date));
    await tx.delete(analysisResult).where(eq(analysisResult.analysisDate, date));
    await tx.delete(utilizationDaily).where(eq(utilizationDaily.analysisDate, date));
    for (const chunk of chunks(resultRows, 200)) await tx.insert(analysisResult).values(chunk);
    for (const chunk of chunks(eventRows, 200)) await tx.insert(downtimeEvent).values(chunk);
    const daily = resultRows.filter((r) => !r.excluded);
    for (const chunk of chunks(daily, 200))
      await tx.insert(utilizationDaily).values(
        chunk.map((r) => ({
          analysisDate: date,
          equipmentId: r.equipmentId!,
          targetMinutes: r.minutes,
          runMinutes: r.runMinutes!,
          idleMinutes: r.idleMinutes!,
          stopMinutes: r.stopMinutes!,
          plannedStopMinutes: r.plannedStopMinutes!,
        })),
      );
  });

  return {
    date,
    analyzed: resultRows.length,
    running: resultRows.filter((r) => !r.excluded).length,
    excluded: resultRows.filter((r) => r.excluded).length,
    events: eventRows.length,
    nonProd,
  };
}

/** 원인 분류 변경 후 해당 설비·일자의 계획정지 분을 재계산 */
export async function recomputePlanned(db: DB, pairs: { date: string; equipmentId: number }[]) {
  const uniq = [...new Map(pairs.map((p) => [`${p.date}:${p.equipmentId}`, p])).values()];
  for (const p of uniq) {
    const [{ planned }] = (
      await db.execute(sql`
        select coalesce(sum(e.duration),0)::int as planned
        from ems_downtime_event e join ems_downtime_cause c on c.code = e.cause_code
        where e.analysis_date = ${p.date} and e.equipment_id = ${p.equipmentId} and c.is_planned`)
    ).rows as { planned: number }[];
    await db
      .update(analysisResult)
      .set({ plannedStopMinutes: planned })
      .where(and(eq(analysisResult.analysisDate, p.date), eq(analysisResult.equipmentId, p.equipmentId)));
    await db
      .update(utilizationDaily)
      .set({ plannedStopMinutes: planned })
      .where(and(eq(utilizationDaily.analysisDate, p.date), eq(utilizationDaily.equipmentId, p.equipmentId)));
  }
}

/** 업로드된 리딩이 포함된 분석일 목록 */
export async function datesWithReadings(db: DB, ids?: number[]) {
  const where = ids?.length ? sql`where equipment_id in (${sql.join(ids, sql`, `)})` : sql``;
  const res = await db.execute(sql`
    select distinct to_char((recorded_at at time zone 'Asia/Seoul') - interval '7 hours', 'YYYY-MM-DD') as d
    from ems_reading ${where} order by 1`);
  return (res.rows as { d: string }[]).map((r) => r.d);
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

