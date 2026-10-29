import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { alertRule } from "@/db/schema";
import { ST_WARN } from "../constants";
import { addDays } from "../time";
import { ppDelta } from "../utils";
import { utilThresholdFor } from "../alerts/rules";
import { analysisDates, dailyRows, rows, weightedUtil, type DailyRow } from "./common";
import type { ResultJson } from "../engine/analyze";
import type { Tag } from "@/db/schema";

export type EventRow = {
  id: number;
  date: string;
  equipmentId: number;
  code: string;
  factory: string;
  state: "idle" | "stop";
  startMinute: number;
  endMinute: number;
  duration: number;
  avgCurrent: number | null;
  minCurrent: number | null;
  maxCurrent: number | null;
  lostUnits: number | null;
  tags: Tag[] | null;
  causeCode: string | null;
  causeName: string | null;
  categoryName: string | null;
  category: string | null;
  causeColor: string | null;
  isPlanned: boolean | null;
  causeSource: string | null;
  suggestedCauseCode: string | null;
  suggestedName: string | null;
  classifiedBy: string | null;
  classifiedAt: string | null;
  memo: string | null;
};

export const EVENT_SELECT = sql`
  select ev.id::int as id, ev.analysis_date::text as date, ev.equipment_id as "equipmentId", e.code, e.factory,
    ev.state, ev.start_minute as "startMinute", ev.end_minute as "endMinute", ev.duration,
    ev.avg_current::float8 as "avgCurrent", ev.min_current::float8 as "minCurrent", ev.max_current::float8 as "maxCurrent",
    ev.lost_units::float8 as "lostUnits", ev.tags,
    ev.cause_code as "causeCode", c.name as "causeName", c.category_name as "categoryName", c.category, c.color as "causeColor",
    c.is_planned as "isPlanned", ev.cause_source as "causeSource",
    ev.suggested_cause_code as "suggestedCauseCode", sc.name as "suggestedName",
    ev.classified_by as "classifiedBy", ev.classified_at::text as "classifiedAt", ev.memo
  from ems_downtime_event ev
  join ems_equipment e on e.id = ev.equipment_id
  left join ems_downtime_cause c on c.code = ev.cause_code
  left join ems_downtime_cause sc on sc.code = ev.suggested_cause_code`;

function summarize(list: DailyRow[]) {
  const idle = list.reduce((a, r) => a + r.idle, 0);
  const stop = list.reduce((a, r) => a + r.stop, 0);
  const lostVals = list.map((r) => r.lost).filter((v): v is number => v != null);
  return {
    util: weightedUtil(list),
    idleMin: idle,
    stopMin: stop,
    downMin: idle + stop,
    lostUnits: lostVals.length ? lostVals.reduce((a, b) => a + b, 0) : null,
    needCheck: list.filter((r) => r.target > 0 && r.run / r.target < ST_WARN).length,
    running: list.length,
  };
}

export async function getDashboard(db: DB, date: string, factory?: string | null) {
  const dates = await analysisDates(db);
  const prevDay = addDays(date, -1);
  const prevWeek = addDays(date, -7);
  const all = await dailyRows(db, { from: prevWeek, to: date, factory, includeExcluded: true });
  const today = all.filter((r) => r.date === date);
  const running = today.filter((r) => !r.excluded);
  const yesterday = all.filter((r) => r.date === prevDay && !r.excluded);
  const weekAgo = all.filter((r) => r.date === prevWeek && !r.excluded);

  const cur = summarize(running);
  const prev = yesterday.length ? summarize(yesterday) : null;
  const wk = weekAgo.length ? summarize(weekAgo) : null;

  const rules = await db.select().from(alertRule);
  const prevByEquip = new Map(yesterday.map((r) => [r.equipmentId, r]));

  const equipment = running
    .map((r) => {
      const util = r.target ? r.run / r.target : 0;
      const p = prevByEquip.get(r.equipmentId);
      const threshold = utilThresholdFor(rules, r);
      return {
        code: r.code,
        factory: r.factory,
        group: r.group,
        target: r.target,
        run: r.run,
        idle: r.idle,
        stop: r.stop,
        planned: r.planned,
        util,
        lost: r.lost,
        deltaPP: p ? ppDelta(util, p.target ? p.run / p.target : 0) : null,
        alertThreshold: threshold,
        belowAlert: threshold != null && util < threshold,
      };
    })
    .sort((a, b) => a.util - b.util);

  const excluded = today.filter((r) => r.excluded).map((r) => r.code);

  const fcond = factory ? sql`and e.factory = ${factory}` : sql``;
  const top5 = await rows<EventRow>(
    db,
    sql`${EVENT_SELECT} where ev.analysis_date = ${date} ${fcond} order by ev.duration desc limit 5`,
  );

  const cls = await rows<{ total: number; classified: number }>(
    db,
    sql`select coalesce(sum(ev.duration),0)::int as total,
          coalesce(sum(case when ev.cause_code is not null then ev.duration end),0)::int as classified
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        where ev.analysis_date = ${date} ${fcond}`,
  );
  const topCauses = await rows<{ name: string; color: string; minutes: number }>(
    db,
    sql`select c.category_name as name, max(c.color) as color, sum(ev.duration)::int as minutes
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        join ems_downtime_cause c on c.code = ev.cause_code
        where ev.analysis_date = ${date} ${fcond}
        group by c.category_name order by 3 desc limit 3`,
  );

  const nonProd = await rows<{ code: string; factory: string; run: number; json: ResultJson }>(
    db,
    sql`select e.code, e.factory, r.run_minutes as run, r.result_json as json
        from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id
        where r.analysis_date = ${date} ${fcond} and r.result_json->'nonProd' is not null and r.result_json->>'nonProd' <> 'null'
        order by e.display_order`,
  );
  const hasMold = (
    await rows<{ n: number }>(db, sql`select count(*)::int as n from ems_mold_production where production_date = ${date}`)
  )[0].n > 0;

  const partial = (
    await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id
          where r.analysis_date = ${date} ${fcond} and (r.result_json->>'partial')::boolean`,
    )
  )[0].n;

  return {
    date,
    dates,
    factory: factory ?? null,
    partial: partial > 0,
    hasMold,
    summary: {
      ...cur,
      excludedCount: excluded.length,
      excluded,
      prev,
      prevWeek: wk,
      utilDeltaDay: prev ? ppDelta(cur.util, prev.util) : null,
      utilDeltaWeek: wk ? ppDelta(cur.util, wk.util) : null,
    },
    equipment,
    top5,
    classification: {
      totalMin: cls[0].total,
      classifiedMin: cls[0].classified,
      rate: cls[0].total ? cls[0].classified / cls[0].total : null,
      top: topCauses,
    },
    nonProd: nonProd.map((n) => ({ code: n.code, factory: n.factory, runMinutes: n.run, ...n.json.nonProd! })),
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
