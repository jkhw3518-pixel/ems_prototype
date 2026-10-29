import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { EVENT_SELECT, type EventRow } from "./dashboard";
import { rows } from "./common";

type Filter = { from: string; to: string; factory?: string | null; equipment?: string | null };

function where(f: Filter): SQL {
  const c: SQL[] = [sql`ev.analysis_date between ${f.from} and ${f.to}`];
  if (f.factory) c.push(sql`e.factory = ${f.factory}`);
  if (f.equipment) c.push(sql`e.code in (${sql.join(f.equipment.split(",").map((x) => sql`${x.trim()}`), sql`, `)})`);
  return sql.join(c, sql` and `);
}

export type ParetoItem = {
  key: string;
  name: string;
  color: string;
  isPlanned: boolean;
  minutes: number;
  count: number;
  lostUnits: number;
  avgMinutes: number;
  pct: number;
  cumPct: number;
};

/** 원인별 손실 집계 (§4.4 pareto). level=category 이면 대분류, cause 이면 세부원인(category 로 한정 가능) */
export async function pareto(db: DB, f: Filter & { level: "category" | "cause"; category?: string | null }) {
  const w = where(f);
  const keyCol = f.level === "category" ? sql`c.category` : sql`c.code`;
  const nameCol = f.level === "category" ? sql`c.category_name` : sql`c.name`;
  const catCond = f.category ? sql`and c.category = ${f.category}` : sql``;
  const list = await rows<Omit<ParetoItem, "pct" | "cumPct" | "avgMinutes">>(
    db,
    sql`select ${keyCol} as key, max(${nameCol}) as name, max(c.color) as color, bool_or(c.is_planned) as "isPlanned",
          sum(ev.duration)::int as minutes, count(*)::int as count, coalesce(sum(ev.lost_units),0)::float8 as "lostUnits"
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        join ems_downtime_cause c on c.code = ev.cause_code
        where ${w} ${catCond}
        group by ${keyCol} order by minutes desc`,
  );
  const total = list.reduce((a, r) => a + r.minutes, 0);
  let cum = 0;
  const items: ParetoItem[] = list.map((r) => {
    cum += r.minutes;
    return { ...r, avgMinutes: r.count ? r.minutes / r.count : 0, pct: total ? r.minutes / total : 0, cumPct: total ? cum / total : 0 };
  });

  const [kpi] = await rows<{ total: number; classified: number; count: number; unclassifiedCount: number; suggested: number }>(
    db,
    sql`select coalesce(sum(ev.duration),0)::int as total,
          coalesce(sum(case when ev.cause_code is not null then ev.duration end),0)::int as classified,
          count(*)::int as count,
          count(*) filter (where ev.cause_code is null)::int as "unclassifiedCount",
          count(*) filter (where ev.cause_code is null and ev.suggested_cause_code is not null)::int as suggested
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id where ${w}`,
  );

  // MTBF / MTTR (고장 대분류)
  const [brk] = await rows<{ count: number; minutes: number }>(
    db,
    sql`select count(*)::int as count, coalesce(sum(ev.duration),0)::int as minutes
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        join ems_downtime_cause c on c.code = ev.cause_code
        where ${w} and c.category = 'BREAKDOWN'`,
  );
  const rw: SQL[] = [sql`r.analysis_date between ${f.from} and ${f.to}`, sql`r.excluded = false`];
  if (f.factory) rw.push(sql`e.factory = ${f.factory}`);
  if (f.equipment) rw.push(sql`e.code in (${sql.join(f.equipment.split(",").map((x) => sql`${x.trim()}`), sql`, `)})`);
  const [run] = await rows<{ run: number }>(
    db,
    sql`select coalesce(sum(r.run_minutes),0)::int as run from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id where ${sql.join(rw, sql` and `)}`,
  );

  return {
    level: f.level,
    category: f.category ?? null,
    items,
    classifiedMinutes: total,
    kpi: {
      totalMinutes: kpi.total,
      classifiedMinutes: kpi.classified,
      unclassifiedMinutes: kpi.total - kpi.classified,
      rate: kpi.total ? kpi.classified / kpi.total : null,
      eventCount: kpi.count,
      unclassifiedCount: kpi.unclassifiedCount,
      suggestedPending: kpi.suggested,
      mtbfMin: brk.count ? run.run / brk.count : null,
      mttrMin: brk.count ? brk.minutes / brk.count : null,
      breakdownCount: brk.count,
    },
  };
}

/** 설비 × 대분류 히트맵 (미분류 포함) */
export async function heatmap(db: DB, f: Filter) {
  const cells = await rows<{ code: string; category: string; name: string; color: string; minutes: number }>(
    db,
    sql`select e.code, coalesce(c.category, 'UNCLASSIFIED') as category, coalesce(max(c.category_name), '미분류') as name,
          coalesce(max(c.color), '#d4d4d8') as color, sum(ev.duration)::int as minutes
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        left join ems_downtime_cause c on c.code = ev.cause_code
        where ${where(f)}
        group by e.code, e.display_order, coalesce(c.category, 'UNCLASSIFIED')
        order by e.display_order`,
  );
  return cells;
}

export async function eventsByCause(db: DB, f: Filter & { category?: string | null; cause?: string | null; limit?: number }) {
  const c: SQL[] = [where(f)];
  if (f.category) c.push(sql`c.category = ${f.category}`);
  if (f.cause) c.push(sql`ev.cause_code = ${f.cause}`);
  return rows<EventRow>(
    db,
    sql`${EVENT_SELECT} where ${sql.join(c, sql` and `)} order by ev.duration desc limit ${f.limit ?? 200}`,
  );
}

/** 미분류 작업함: 오래된 순 */
export async function unclassifiedInbox(db: DB, f: Filter & { limit?: number }) {
  return rows<EventRow>(
    db,
    sql`${EVENT_SELECT} where ${where(f)} and ev.cause_code is null
        order by ev.analysis_date asc, ev.duration desc limit ${f.limit ?? 100}`,
  );
}
