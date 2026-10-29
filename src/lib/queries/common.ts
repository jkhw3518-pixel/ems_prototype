import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";

export async function rows<T>(db: DB, q: SQL): Promise<T[]> {
  return (await db.execute(q)).rows as T[];
}

export async function analysisDates(db: DB): Promise<string[]> {
  const r = await rows<{ d: string }>(db, sql`select distinct analysis_date::text as d from ems_analysis_result order by 1 desc`);
  return r.map((x) => x.d);
}

export async function latestAnalysisDate(db: DB): Promise<string | null> {
  return (await analysisDates(db))[0] ?? null;
}

export type DailyRow = {
  date: string;
  equipmentId: number;
  code: string;
  factory: string;
  group: string;
  target: number;
  run: number;
  idle: number;
  stop: number;
  planned: number;
  excluded: boolean;
  lost: number | null;
};

/** 분석 결과 일별 행 (기간·공장·설비 필터) */
export async function dailyRows(
  db: DB,
  opt: { from: string; to: string; factory?: string | null; codes?: string[] | null; includeExcluded?: boolean },
): Promise<DailyRow[]> {
  const conds: SQL[] = [sql`r.analysis_date between ${opt.from} and ${opt.to}`];
  if (opt.factory) conds.push(sql`e.factory = ${opt.factory}`);
  if (opt.codes?.length) conds.push(sql`e.code in (${sql.join(opt.codes.map((c) => sql`${c}`), sql`, `)})`);
  if (!opt.includeExcluded) conds.push(sql`r.excluded = false`);
  return rows<DailyRow>(
    db,
    sql`select r.analysis_date::text as date, e.id as "equipmentId", e.code, e.factory, e."group" as group,
          r.minutes as target, r.run_minutes as run, r.idle_minutes as idle, r.stop_minutes as stop,
          r.planned_stop_minutes as planned, r.excluded, r.lost_units::float8 as lost
        from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id
        where ${sql.join(conds, sql` and `)}
        order by e.display_order, r.analysis_date`,
  );
}

/** Σ정상가동 / Σ대상분 (분 가중) */
export function weightedUtil(list: Pick<DailyRow, "run" | "target" | "planned">[], excludePlanned = false): number | null {
  let run = 0;
  let target = 0;
  for (const r of list) {
    run += r.run;
    target += r.target - (excludePlanned ? r.planned : 0);
  }
  return target > 0 ? run / target : null;
}
