import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { alertRule, criteria, equipment, moldProduction, reading } from "@/db/schema";
import { HttpError } from "../api";
import { classify } from "../engine/core";
import type { ResultJson } from "../engine/analyze";
import { addDays, dayEnd, dayStart } from "../time";
import { ppDelta } from "../utils";
import { utilThresholdFor } from "../alerts/rules";
import { dailyRows, rows } from "./common";
import { EVENT_SELECT, type EventRow } from "./dashboard";

export async function getEquipmentDetail(db: DB, code: string, date: string | null) {
  const [e] = await db.select().from(equipment).where(eq(equipment.code, code));
  if (!e) throw new HttpError(404, `설비 ${code} 없음`);

  const dates = (
    await rows<{ d: string }>(db, sql`select analysis_date::text as d from ems_analysis_result where equipment_id = ${e.id} order by 1 desc`)
  ).map((r) => r.d);
  const d = date ?? dates[0] ?? null;
  if (!d) return { equipment: e, date: null, dates, result: null, series: [], events: [], spark: [], mold: [], deltas: null, threshold: null, crit: null };

  const [result] = await rows<{
    target: number; run: number; idle: number; stop: number; planned: number; excluded: boolean; util: number; lost: number | null; json: ResultJson;
  }>(
    db,
    sql`select minutes as target, run_minutes as run, idle_minutes as idle, stop_minutes as stop, planned_stop_minutes as planned,
          excluded, utilization_rate::float8 as util, lost_units::float8 as lost, result_json as json
        from ems_analysis_result where equipment_id = ${e.id} and analysis_date = ${d}`,
  );

  const from = dayStart(d);
  const readings = await db
    .select({ t: reading.recordedAt, v: reading.currentValue })
    .from(reading)
    .where(and(eq(reading.equipmentId, e.id), gte(reading.recordedAt, from), lt(reading.recordedAt, dayEnd(d))));
  const raw: (number | null)[] = new Array(1440).fill(null);
  for (const r of readings) {
    const m = Math.floor((new Date(r.t).getTime() - from.getTime()) / 60_000);
    if (m >= 0 && m < 1440) raw[m] = Number(r.v);
  }
  const [cr] = await db.select().from(criteria).where(eq(criteria.group, e.group));
  const crit = result?.json?.crit ?? (cr ? { stop: Number(cr.stopThreshold), idle: Number(cr.idleThreshold), duration: cr.durationMin } : { stop: 5, idle: 50, duration: 5 });
  const c = classify(raw, crit);
  // 차트 용량을 줄이기 위해 [분, 전류, 상태코드] 로 전달
  const series = raw.map((v, i) => ({ m: i, v, s: i < c.target ? c.states[i] : null }));

  const events = await rows<EventRow>(db, sql`${EVENT_SELECT} where ev.equipment_id = ${e.id} and ev.analysis_date = ${d} order by ev.start_minute`);

  const hist = await dailyRows(db, { from: addDays(d, -29), to: d, codes: [code], includeExcluded: true });
  const spark = hist.map((h) => ({ date: h.date, util: h.excluded || !h.target ? null : h.run / h.target }));
  const utilAt = (x: string) => spark.find((s) => s.date === x)?.util ?? null;
  const cur = utilAt(d);

  const mold = await db.select().from(moldProduction).where(and(eq(moldProduction.equipmentId, e.id), eq(moldProduction.productionDate, d)));
  const rules = await db.select().from(alertRule);

  return {
    equipment: e,
    date: d,
    dates,
    result: result ?? null,
    crit,
    series,
    events,
    spark,
    mold,
    threshold: utilThresholdFor(rules, e),
    deltas: { day: ppDelta(cur, utilAt(addDays(d, -1))), week: ppDelta(cur, utilAt(addDays(d, -7))) },
  };
}

export type EquipmentDetail = Awaited<ReturnType<typeof getEquipmentDetail>>;
