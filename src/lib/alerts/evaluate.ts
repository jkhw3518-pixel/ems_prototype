import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  alertChannel, alertLog, alertRule, alertRuleChannel, criteria, equipment, reading, type Delivery,
} from "@/db/schema";
import { ALERT_DAILY_CAP, RULE_TYPE_LABEL } from "../constants";
import { classify } from "../engine/core";
import { addDays, analysisDateOf, dayStart, formatKst, isoWeek, kstClock, minuteToTs } from "../time";
import { pct } from "../utils";
import { dailyRows, latestAnalysisDate, rows, weightedUtil, type DailyRow } from "../queries/common";
import { appUrl, deliver, type AlertMessage, type ChannelRecord } from "./channels";
import { rulesFor } from "./rules";

type Rule = typeof alertRule.$inferSelect;
type Equip = typeof equipment.$inferSelect;

export type Candidate = {
  rule: Rule;
  equip: Equip;
  observed: number;
  dedupKey: string;
  eventId: number | null;
  message: AlertMessage;
  /** 상태가 이미 정상 복구된 경우 그 시각 */
  resolvedAt: Date | null;
};

type EventLite = {
  id: number;
  date: string;
  equipmentId: number;
  state: string;
  startMinute: number;
  endMinute: number;
  duration: number;
  isPlanned: boolean | null;
};

function link(code: string, date?: string, eventId?: number | null) {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (eventId) q.set("event", String(eventId));
  return appUrl(`/equipment/${encodeURIComponent(code)}${q.size ? `?${q}` : ""}`);
}

function utilOf(list: DailyRow[], excludePlanned: boolean) {
  return list.length ? weightedUtil(list, excludePlanned) : null;
}

/** 지정 분석일들에 대한 규칙 위반 후보 계산 (평가/미리보기 공용) */
export async function collectCandidates(
  db: DB,
  opt: { dates: string[]; rules?: Rule[]; trigger: "analysis" | "cron" | "preview"; weekDates?: string[] },
): Promise<Candidate[]> {
  const rules = opt.rules ?? (await db.select().from(alertRule).where(eq(alertRule.active, true)));
  if (!rules.length || !opt.dates.length) return [];
  const equips = await db.select().from(equipment).where(eq(equipment.active, true));
  const sorted = [...opt.dates].sort();
  const from = addDays(sorted[0], -14);
  const to = sorted[sorted.length - 1];
  const daily = await dailyRows(db, { from, to, includeExcluded: true });
  const dayKey = (id: number, d: string) => `${id}:${d}`;
  const dailyMap = new Map(daily.map((r) => [dayKey(r.equipmentId, r.date), r]));

  const events = await rows<EventLite>(
    db,
    sql`select ev.id::int as id, ev.analysis_date::text as date, ev.equipment_id as "equipmentId", ev.state,
          ev.start_minute as "startMinute", ev.end_minute as "endMinute", ev.duration, c.is_planned as "isPlanned"
        from ems_downtime_event ev left join ems_downtime_cause c on c.code = ev.cause_code
        where ev.analysis_date in (${sql.join(opt.dates.map((d) => sql`${d}`), sql`, `)})`,
  );

  const posthoc = opt.trigger !== "cron" ? " (사후 탐지)" : "";
  const out: Candidate[] = [];

  for (const e of equips) {
    const applicable = rulesFor(rules, e);
    if (!applicable.length) continue;
    for (const rule of applicable) {
      const th = Number(rule.threshold);
      const label = RULE_TYPE_LABEL[rule.ruleType] ?? rule.ruleType;
      const base = (title: string, valueText: string, at: string, lines: string[], date?: string, eventId?: number | null): AlertMessage => ({
        severity: rule.severity as AlertMessage["severity"],
        title,
        equipment: e.code,
        typeLabel: label,
        valueText,
        at,
        lines: [`공장: ${e.factory} / 그룹: ${e.group}`, ...lines, `규칙: ${rule.name}`],
        link: link(e.code, date, eventId),
        ackLink: appUrl("/alerts"),
      });

      if (rule.ruleType === "UTIL_BELOW" || rule.ruleType === "UTIL_DROP") {
        const period = rule.period ?? "day";
        if (period === "rolling_2h") continue; // 실시간 평가 전용
        const evalDates = period === "week" ? (opt.weekDates ?? []) : opt.dates;
        for (const d of evalDates) {
          let cur: number | null;
          let prev: number | null = null;
          let periodKey: string;
          if (period === "week") {
            const w = isoWeek(d);
            periodKey = w.key;
            const curRows = range(w.start, 7).map((x) => dailyMap.get(dayKey(e.id, x))).filter(notExcluded);
            cur = utilOf(curRows, rule.excludePlanned);
            const prevRows = range(addDays(w.start, -7), 7).map((x) => dailyMap.get(dayKey(e.id, x))).filter(notExcluded);
            prev = utilOf(prevRows, rule.excludePlanned);
          } else {
            periodKey = d;
            const r = dailyMap.get(dayKey(e.id, d));
            if (!r || r.excluded) continue; // 미가동 제외 설비는 UTIL_* 평가 제외
            cur = utilOf([r], rule.excludePlanned);
            const p = dailyMap.get(dayKey(e.id, addDays(d, -1)));
            prev = p && !p.excluded ? utilOf([p], rule.excludePlanned) : null;
          }
          if (cur == null) continue;
          const periodText = period === "week" ? `${periodKey} 주간` : `${d} 일`;
          if (rule.ruleType === "UTIL_BELOW" && cur < th) {
            out.push({
              rule, equip: e, observed: cur, eventId: null, resolvedAt: null,
              dedupKey: `${rule.id}:${e.id}:${periodKey}`,
              message: base(
                `${e.code} ${periodText} 가동율 ${pct(cur)} (기준 ${pct(th, 0)} 미만)`,
                pct(cur),
                d,
                [`${periodText} 가동율: ${pct(cur)}${prev != null ? `  (직전 대비 ${fmtPP((cur - prev) * 100)})` : ""}`],
                period === "week" ? undefined : d,
              ),
            });
          }
          if (rule.ruleType === "UTIL_DROP" && prev != null) {
            const drop = (prev - cur) * 100;
            if (drop >= th) {
              out.push({
                rule, equip: e, observed: Math.round(drop * 10) / 10, eventId: null, resolvedAt: null,
                dedupKey: `${rule.id}:${e.id}:${periodKey}`,
                message: base(
                  `${e.code} 가동율 급락 ▼ ${drop.toFixed(1)}%p`,
                  `▼ ${drop.toFixed(1)}%p`,
                  d,
                  [`${periodText} 가동율: ${pct(cur)} (직전 ${pct(prev)})`],
                  period === "week" ? undefined : d,
                ),
              });
            }
          }
        }
        continue;
      }

      if (rule.ruleType === "STOP_DURATION" || rule.ruleType === "IDLE_DURATION") {
        const state = rule.ruleType === "STOP_DURATION" ? "stop" : "idle";
        for (const ev of events) {
          if (ev.equipmentId !== e.id || ev.state !== state || ev.duration < th) continue;
          if (rule.excludePlanned && ev.isPlanned) continue; // 계획정지로 분류 확정된 구간은 제외
          const startTs = minuteToTs(ev.date, ev.startMinute);
          const dr = dailyMap.get(dayKey(e.id, ev.date));
          const util = dr && dr.target ? dr.run / dr.target : null;
          const stLabel = state === "stop" ? "완전정지" : "공회전(비가동)";
          const ongoing = ev.endMinute >= (dr?.target ?? 1440);
          out.push({
            rule, equip: e, observed: ev.duration, eventId: ev.id,
            dedupKey: `${rule.id}:${e.id}:${startTs.toISOString().slice(0, 16)}`,
            resolvedAt: ongoing ? null : minuteToTs(ev.date, ev.endMinute),
            message: base(
              `${e.code} ${stLabel} ${ev.duration}분 지속${posthoc}`,
              `${ev.duration}분`,
              formatKst(startTs),
              [
                `시작: ${formatKst(startTs)}  ${ongoing ? "(종료 시점까지 지속)" : `~ ${formatKst(minuteToTs(ev.date, ev.endMinute), false)}`}`,
                ...(util != null ? [`당일 가동율: ${pct(util)}`] : []),
              ],
              ev.date,
              ev.id,
            ),
          });
        }
      }
    }
  }
  return out;
}

const notExcluded = (r: DailyRow | undefined): r is DailyRow => !!r && !r.excluded;
const range = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));
const fmtPP = (pp: number) => `${pp >= 0 ? "▲ +" : "▼ −"}${Math.abs(pp).toFixed(1)}%p`;

/** 실시간 수집 시: 진행 중인 정지/공회전 구간과 최근 2시간 가동율 평가 (§11.3) */
async function collectRealtime(db: DB, rules: Rule[]): Promise<Candidate[]> {
  const now = new Date();
  const date = analysisDateOf(now);
  const start = dayStart(date);
  const fresh = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reading)
    .where(gte(reading.recordedAt, new Date(now.getTime() - 10 * 60_000)));
  if (!fresh[0]?.n) return []; // 실시간 데이터가 들어오지 않는 배치 운영 중

  const equips = await db.select().from(equipment).where(eq(equipment.active, true));
  const crits = new Map((await db.select().from(criteria)).map((c) => [c.group, c]));
  const data = await db
    .select({ e: reading.equipmentId, t: reading.recordedAt, v: reading.currentValue })
    .from(reading)
    .where(and(gte(reading.recordedAt, start), lt(reading.recordedAt, now)));
  const byEquip = new Map<number, (number | null)[]>();
  for (const r of data) {
    const m = Math.floor((new Date(r.t).getTime() - start.getTime()) / 60_000);
    if (m < 0 || m >= 1440) continue;
    let arr = byEquip.get(r.e);
    if (!arr) byEquip.set(r.e, (arr = new Array(1440).fill(null)));
    arr[m] = Number(r.v);
  }

  const out: Candidate[] = [];
  for (const e of equips) {
    const raw = byEquip.get(e.id);
    if (!raw) continue;
    const cr = crits.get(e.group);
    const c = classify(raw, cr ? { stop: Number(cr.stopThreshold), idle: Number(cr.idleThreshold), duration: cr.durationMin } : { stop: 5, idle: 50, duration: 5 });
    if (!c.target || c.excluded) continue;
    const lastState = c.states[c.target - 1];
    let s = c.target - 1;
    while (s > 0 && c.states[s - 1] === lastState) s--;
    const dur = c.target - s;
    for (const rule of rulesFor(rules, e)) {
      const th = Number(rule.threshold);
      const sev = rule.severity as AlertMessage["severity"];
      if ((rule.ruleType === "STOP_DURATION" && lastState === "stop") || (rule.ruleType === "IDLE_DURATION" && lastState === "idle")) {
        if (dur < th) continue;
        const startTs = minuteToTs(date, s);
        const lbl = lastState === "stop" ? "완전정지" : "공회전(비가동)";
        out.push({
          rule, equip: e, observed: dur, eventId: null, resolvedAt: null,
          dedupKey: `${rule.id}:${e.id}:${startTs.toISOString().slice(0, 16)}`,
          message: {
            severity: sev, title: `${e.code} ${lbl} ${dur}분 지속`, equipment: e.code,
            typeLabel: RULE_TYPE_LABEL[rule.ruleType], valueText: `${dur}분`, at: formatKst(startTs),
            lines: [`공장: ${e.factory} / 그룹: ${e.group}`, `시작: ${formatKst(startTs)}  (진행 중)`, `오늘 가동율: ${pct(c.run / c.target)}`, `규칙: ${rule.name}`],
            link: link(e.code, date), ackLink: appUrl("/alerts"),
          },
        });
      }
      if (rule.ruleType === "UTIL_BELOW" && rule.period === "rolling_2h" && c.target >= 120) {
        const win = c.states.slice(c.target - 120, c.target);
        const u = win.filter((x) => x === "run").length / 120;
        if (u < th) {
          const hourKey = formatKst(now).slice(0, 13);
          out.push({
            rule, equip: e, observed: u, eventId: null, resolvedAt: null,
            dedupKey: `${rule.id}:${e.id}:${hourKey}`,
            message: {
              severity: sev, title: `${e.code} 최근 2시간 가동율 ${pct(u)}`, equipment: e.code,
              typeLabel: RULE_TYPE_LABEL[rule.ruleType], valueText: pct(u), at: formatKst(now),
              lines: [`공장: ${e.factory} / 그룹: ${e.group}`, `최근 2시간 가동율: ${pct(u)} (기준 ${pct(th, 0)})`, `규칙: ${rule.name}`],
              link: link(e.code, date), ackLink: appUrl("/alerts"),
            },
          });
        }
      }
    }
  }
  return out;
}

function inQuiet(rule: Rule, now = new Date()): boolean {
  if (!rule.quietStart || !rule.quietEnd || rule.severity === "critical") return false;
  const t = kstClock(now);
  const s = rule.quietStart.slice(0, 8);
  const e = rule.quietEnd.slice(0, 8);
  return s <= e ? t >= s && t < e : t >= s || t < e; // 자정 넘김 지원
}

async function channelsByRule(db: DB) {
  const links = await db
    .select({ ruleId: alertRuleChannel.ruleId, ch: alertChannel })
    .from(alertRuleChannel)
    .innerJoin(alertChannel, eq(alertChannel.id, alertRuleChannel.channelId))
    .where(eq(alertChannel.active, true));
  const m = new Map<number, ChannelRecord[]>();
  for (const l of links) m.set(l.ruleId, [...(m.get(l.ruleId) ?? []), l.ch]);
  return m;
}

async function sendAll(chs: ChannelRecord[], msg: AlertMessage): Promise<Delivery[]> {
  return Promise.all(
    chs.map(async (ch) => {
      const r = await deliver(ch, msg);
      return {
        channel_id: ch.id,
        status: r.ok ? "sent" : "failed",
        error: r.error ?? (r.dryRun ? "dry-run" : undefined),
        sent_at: new Date().toISOString(),
        attempts: r.attempts,
      } satisfies Delivery;
    }),
  );
}

export type EvaluateResult = {
  trigger: string;
  dates: string[];
  candidates: number;
  created: number;
  skipped: { dedup: number; cooldown: number; cap: number };
  held: number;
  releasedHeld: number;
  resolved: number;
  ms: number;
};

/** 알림 평가 엔진 (§11.3) */
export async function evaluateAlerts(db: DB, trigger: "analysis" | "cron", date?: string): Promise<EvaluateResult> {
  const t0 = Date.now();
  const rules = await db.select().from(alertRule).where(eq(alertRule.active, true));
  const chMap = await channelsByRule(db);
  const now = new Date();

  // 평가 대상일
  let dates: string[] = [];
  let weekDates: string[] = [];
  if (trigger === "analysis" && date) {
    dates = [date];
    // 주간 규칙: 해당 주의 마지막 날(일요일) 분석이 끝났을 때
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) weekDates = [date];
  } else {
    const latest = await latestAnalysisDate(db);
    if (latest) dates = [latest];
    // 월요일 07:30 이후 첫 cron 에서 지난주 평가 (dedup 으로 1회만 발송)
    const kst = new Date(now.getTime() + 9 * 3600_000);
    if (kst.getUTCDay() === 1 && kstClock(now) >= "07:30:00") weekDates = [addDays(analysisDateOf(now), -1)];
  }

  const cands = [
    ...(await collectCandidates(db, { dates, rules, trigger, weekDates })),
    ...(trigger === "cron" ? await collectRealtime(db, rules) : []),
  ];

  const skipped = { dedup: 0, cooldown: 0, cap: 0 };
  let created = 0;
  let held = 0;
  const todayStart = dayStart(analysisDateOf(now));

  for (const c of cands) {
    const dup = await db.select({ id: alertLog.id }).from(alertLog).where(eq(alertLog.dedupKey, c.dedupKey)).limit(1);
    if (dup.length) { skipped.dedup++; continue; }
    const last = await db
      .select({ at: alertLog.triggeredAt })
      .from(alertLog)
      .where(and(eq(alertLog.ruleId, c.rule.id), eq(alertLog.equipmentId, c.equip.id)))
      .orderBy(desc(alertLog.triggeredAt))
      .limit(1);
    if (last[0] && now.getTime() - new Date(last[0].at).getTime() < c.rule.cooldownMin * 60_000) { skipped.cooldown++; continue; }
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(alertLog)
      .where(and(eq(alertLog.ruleId, c.rule.id), eq(alertLog.equipmentId, c.equip.id), gte(alertLog.triggeredAt, todayStart)));
    if (n >= ALERT_DAILY_CAP) { skipped.cap++; continue; }

    const chs = chMap.get(c.rule.id) ?? [];
    let delivery: Delivery[];
    if (inQuiet(c.rule, now)) {
      delivery = chs.map((ch) => ({ channel_id: ch.id, status: "held" }));
      held++;
    } else {
      delivery = await sendAll(chs, c.message);
    }
    await db.insert(alertLog).values({
      ruleId: c.rule.id,
      equipmentId: c.equip.id,
      eventId: c.eventId,
      observedValue: Math.round(c.observed * 1000) / 1000,
      message: [c.message.title, ...c.message.lines].join("\n"),
      dedupKey: c.dedupKey,
      delivery,
      resolvedAt: c.resolvedAt,
    });
    created++;
  }

  const releasedHeld = await releaseHeld(db, rules, chMap, now);
  const resolved = await resolveRecovered(db, chMap);

  return { trigger, dates, candidates: cands.length, created, skipped, held, releasedHeld, resolved, ms: Date.now() - t0 };
}

/** 방해금지 해제 후 보류분 묶음 발송 */
async function releaseHeld(db: DB, rules: Rule[], chMap: Map<number, ChannelRecord[]>, now: Date) {
  const pending = await rows<{ id: number; ruleId: number; message: string; delivery: Delivery[] }>(
    db,
    sql`select id::int as id, rule_id as "ruleId", message, delivery from ems_alert_log
        where delivery @> '[{"status":"held"}]'::jsonb and triggered_at > now() - interval '2 days'`,
  );
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const ready = pending.filter((p) => {
    const r = ruleById.get(p.ruleId);
    return r && !inQuiet(r, now);
  });
  if (!ready.length) return 0;

  // 채널별로 묶어서 1건으로 발송
  const byChannel = new Map<number, typeof ready>();
  for (const p of ready) for (const d of p.delivery) if (d.status === "held") byChannel.set(d.channel_id, [...(byChannel.get(d.channel_id) ?? []), p]);
  const allChs = new Map([...chMap.values()].flat().map((c) => [c.id, c]));
  const results = new Map<string, Delivery>();
  for (const [chId, list] of byChannel) {
    const ch = allChs.get(chId);
    const msg: AlertMessage = {
      severity: "warning",
      title: `방해금지 시간 중 보류된 알림 ${list.length}건`,
      typeLabel: "보류 알림 묶음",
      valueText: `${list.length}건`,
      at: formatKst(now),
      lines: list.slice(0, 20).map((p) => p.message.split("\n")[0]),
      link: appUrl("/alerts"),
    };
    const r = ch ? await deliver(ch, msg) : { ok: false, error: "채널 비활성/삭제됨", attempts: 0 };
    for (const p of list)
      results.set(`${p.id}:${chId}`, { channel_id: chId, status: r.ok ? "sent" : "failed", error: r.error, sent_at: now.toISOString(), attempts: r.attempts });
  }
  for (const p of ready) {
    const delivery = p.delivery.map((d) => (d.status === "held" ? results.get(`${p.id}:${d.channel_id}`) ?? d : d));
    await db.update(alertLog).set({ delivery }).where(eq(alertLog.id, p.id));
  }
  return ready.length;
}

/** 열린 알림 중 정상 복구된 건 resolved 처리 (+ 선택적 복구 알림) */
async function resolveRecovered(db: DB, chMap: Map<number, ChannelRecord[]>) {
  const open = await rows<{ id: number; ruleId: number; ruleType: string; equipmentId: number; dedupKey: string; threshold: number; period: string | null; code: string }>(
    db,
    sql`select l.id::int as id, l.rule_id as "ruleId", r.rule_type as "ruleType", l.equipment_id as "equipmentId", l.dedup_key as "dedupKey",
          r.threshold::float8 as threshold, r.period, e.code
        from ems_alert_log l join ems_alert_rule r on r.id = l.rule_id join ems_equipment e on e.id = l.equipment_id
        where l.resolved_at is null and l.triggered_at > now() - interval '14 days'`,
  );
  let n = 0;
  for (const o of open) {
    let resolvedAt: Date | null = null;
    if (o.ruleType === "STOP_DURATION" || o.ruleType === "IDLE_DURATION") {
      // 시작 이후 정상가동 리딩이 들어왔으면 복구
      const startIso = o.dedupKey.split(":").slice(2).join(":");
      const start = new Date(`${startIso}:00Z`);
      const [cr] = await rows<{ idle: number }>(
        db,
        sql`select c.idle_threshold::float8 as idle from ems_criteria c join ems_equipment e on e."group" = c."group" where e.id = ${o.equipmentId}`,
      );
      if (!cr) continue;
      const [first] = await rows<{ t: string }>(
        db,
        sql`select recorded_at::text as t from ems_reading where equipment_id = ${o.equipmentId} and recorded_at > ${start.toISOString()}
            and current_value > ${cr.idle} order by recorded_at limit 1`,
      );
      if (first) resolvedAt = new Date(first.t);
    } else if (o.ruleType === "UTIL_BELOW" && (o.period ?? "day") === "day") {
      const d = o.dedupKey.split(":")[2];
      const [nx] = await rows<{ run: number; target: number }>(
        db,
        sql`select run_minutes as run, minutes as target from ems_analysis_result where equipment_id = ${o.equipmentId}
            and analysis_date > ${d} and excluded = false order by analysis_date limit 1`,
      );
      if (nx && nx.target && nx.run / nx.target >= o.threshold) resolvedAt = new Date();
    }
    if (!resolvedAt) continue;
    await db.update(alertLog).set({ resolvedAt }).where(and(eq(alertLog.id, o.id), isNull(alertLog.resolvedAt)));
    n++;
    if (process.env.ALERT_SEND_RECOVERY === "true") {
      const chs = chMap.get(o.ruleId) ?? [];
      await sendAll(chs, {
        severity: "info",
        title: `${o.code} 정상 복구`,
        equipment: o.code,
        typeLabel: "복구",
        valueText: "정상",
        at: formatKst(resolvedAt),
        lines: [`복구 시각: ${formatKst(resolvedAt)}`],
        link: link(o.code),
      });
    }
  }
  return n;
}

/** 규칙 미리보기: 최근 7일 데이터에 적용했다면 몇 건이 발생했을지 (§11.5) */
export async function previewRule(db: DB, rule: Rule) {
  const latest = await latestAnalysisDate(db);
  if (!latest) return { count: 0, samples: [] as string[], from: null, to: null };
  const dates = range(addDays(latest, -6), 7);
  const weekDates = [...new Set(dates.map((d) => addDays(isoWeek(d).start, 6)))].filter((d) => d <= latest);
  // 미리보기 대상 규칙만 활성으로 두고, 같은 유형의 다른 규칙과의 구체성 경쟁은 무시
  const cands = await collectCandidates(db, { dates, rules: [{ ...rule, active: true }], trigger: "preview", weekDates });
  return {
    count: cands.length,
    samples: cands.slice(0, 8).map((c) => c.message.title),
    from: dates[0],
    to: latest,
    byEquipment: Object.entries(cands.reduce<Record<string, number>>((a, c) => ((a[c.equip.code] = (a[c.equip.code] ?? 0) + 1), a), {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  };
}

export async function testChannel(db: DB, id: number) {
  const [ch] = await db.select().from(alertChannel).where(eq(alertChannel.id, id));
  if (!ch) return { ok: false, error: "채널 없음" };
  const r = await deliver(ch, {
    severity: "info",
    title: "테스트 메시지 — 새한프라텍 EMS 알림 채널 연결 확인",
    equipment: "TEST",
    typeLabel: "테스트",
    valueText: "-",
    at: formatKst(new Date()),
    lines: [`채널: ${ch.name} (${ch.channelType})`, "이 메시지가 보이면 알림 수신 설정이 완료된 것입니다."],
    link: appUrl("/settings?tab=channels"),
  });
  if (r.ok) await db.update(alertChannel).set({ verifiedAt: new Date() }).where(eq(alertChannel.id, id));
  return r;
}

/** 최근 3회 연속 발송 실패 채널 (§11.6) */
export async function failingChannels(db: DB): Promise<number[]> {
  const logs = await rows<{ delivery: Delivery[] }>(
    db,
    sql`select delivery from ems_alert_log where delivery is not null and jsonb_array_length(delivery) > 0 order by triggered_at desc limit 300`,
  );
  const hist = new Map<number, string[]>();
  for (const l of logs) for (const d of l.delivery) if (d.status !== "held") hist.set(d.channel_id, [...(hist.get(d.channel_id) ?? []), d.status]);
  return [...hist.entries()].filter(([, s]) => s.length >= 3 && s.slice(0, 3).every((x) => x === "failed")).map(([id]) => id);
}

