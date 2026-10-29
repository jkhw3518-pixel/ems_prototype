import { sql } from "drizzle-orm";
import { handler, qs, requireDate, type P } from "@/lib/api";
import { rows } from "@/lib/queries/common";

export const GET = handler<P<"date">>(async (req, db, { params }) => {
  const date = requireDate((await params).date);
  const factory = qs(req).get("factory");
  return rows(
    db,
    sql`select e.code, e.factory, e."group" as group, r.status, r.minutes, r.run_minutes as "runMinutes", r.idle_minutes as "idleMinutes",
          r.stop_minutes as "stopMinutes", r.planned_stop_minutes as "plannedStopMinutes", r.excluded,
          r.utilization_rate::float8 as "utilizationRate", r.lost_units::float8 as "lostUnits", r.result_json as "resultJson"
        from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id
        where r.analysis_date = ${date} ${factory ? sql`and e.factory = ${factory}` : sql``}
        order by e.display_order`,
  );
});
