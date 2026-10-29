import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { equipment, moldProduction, uploadLog } from "@/db/schema";
import { runAnalysis } from "./engine/analyze";
import { evaluateAlerts, type EvaluateResult } from "./alerts/evaluate";
import { analysisDateOf } from "./time";
import type { EmsPoint, MoldRow } from "./parsers";

/** EMS 1분 리딩 저장 (같은 설비·시각은 덮어쓰기). 반환: 영향받은 분석일 */
export async function ingestEms(db: DB, points: EmsPoint[]) {
  const equips = await db.select().from(equipment);
  const idByCode = new Map(equips.map((e) => [e.code, e.id]));
  const unknown = new Set<string>();
  const dates = new Set<string>();
  const dedup = new Map<string, { e: number; t: Date; v: number }>();
  for (const p of points) {
    const id = idByCode.get(p.code);
    if (!id) {
      unknown.add(p.code);
      continue;
    }
    // 1분 단위로 내림
    const t = new Date(Math.floor(p.ts.getTime() / 60_000) * 60_000);
    dedup.set(`${id}:${t.getTime()}`, { e: id, t, v: p.value });
    dates.add(analysisDateOf(t));
  }
  const list = [...dedup.values()];
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    await db.execute(sql`
      insert into ems_reading (equipment_id, recorded_at, current_value)
      values ${sql.join(chunk.map((r) => sql`(${r.e}, ${r.t.toISOString()}, ${r.v})`), sql`, `)}
      on conflict (equipment_id, recorded_at) do update set current_value = excluded.current_value`);
  }
  return { saved: list.length, unknown: [...unknown], dates: [...dates].sort() };
}

export async function ingestMold(db: DB, rows: MoldRow[]) {
  const equips = await db.select().from(equipment);
  const idByCode = new Map(equips.map((e) => [e.code, e.id]));
  const unknown = new Set<string>();
  const dates = new Set<string>();
  let saved = 0;
  for (const r of rows) {
    const id = idByCode.get(r.code);
    if (!id) {
      unknown.add(r.code);
      continue;
    }
    await db
      .insert(moldProduction)
      .values({
        equipmentId: id, productionDate: r.date, deptCode: r.deptCode, orderNo: r.orderNo, itemName: r.itemName,
        inputQty: r.inputQty, goodQty: r.goodQty, capa12hr: r.capa12hr,
      })
      .onConflictDoUpdate({
        target: [moldProduction.equipmentId, moldProduction.productionDate, moldProduction.orderNo],
        set: { deptCode: r.deptCode, itemName: r.itemName, inputQty: r.inputQty, goodQty: r.goodQty, capa12hr: r.capa12hr },
      });
    dates.add(r.date);
    saved++;
  }
  return { saved, unknown: [...unknown], dates: [...dates].sort() };
}

/** 분석 → 원인 추천 → 일 집계 → 알림 평가 (§6.6) */
export async function analyzeAndAlert(db: DB, dates: string[], opts: { alerts?: boolean } = {}) {
  const results: { date: string; analyzed: number; running: number; excluded: number; events: number; alerts?: EvaluateResult; error?: string }[] = [];
  for (const d of dates) {
    try {
      const r = await runAnalysis(db, d);
      const alerts = opts.alerts === false ? undefined : await evaluateAlerts(db, "analysis", d);
      results.push({ date: d, analyzed: r.analyzed, running: r.running, excluded: r.excluded, events: r.events, alerts });
    } catch (e) {
      results.push({ date: d, analyzed: 0, running: 0, excluded: 0, events: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

export async function logUpload(db: DB, kind: "ems" | "mold", fileName: string, rowCount: number, dates: string[], message?: string) {
  await db.insert(uploadLog).values({ kind, fileName, rowCount, dates, message });
}
