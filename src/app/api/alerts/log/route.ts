import { sql, type SQL } from "drizzle-orm";
import { handler, isDate, qs } from "@/lib/api";
import { rows } from "@/lib/queries/common";
import { dayEnd, dayStart } from "@/lib/time";
import type { Delivery } from "@/db/schema";

export type AlertLogRow = {
  id: number;
  triggeredAt: string;
  ruleId: number;
  ruleName: string;
  ruleType: string;
  severity: string;
  code: string | null;
  factory: string | null;
  eventId: number | null;
  eventDate: string | null;
  observedValue: number | null;
  message: string;
  delivery: Delivery[] | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

/** ?from&to&status=open|acked|resolved|unacked&severity=critical */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  const c: SQL[] = [sql`true`];
  const from = q.get("from");
  const to = q.get("to");
  if (isDate(from)) c.push(sql`l.triggered_at >= ${dayStart(from).toISOString()}`);
  if (isDate(to)) c.push(sql`l.triggered_at < ${dayEnd(to).toISOString()}`);
  const st = q.get("status");
  if (st === "open") c.push(sql`l.acknowledged_at is null and l.resolved_at is null`);
  if (st === "unacked") c.push(sql`l.acknowledged_at is null`);
  if (st === "acked") c.push(sql`l.acknowledged_at is not null`);
  if (st === "resolved") c.push(sql`l.resolved_at is not null`);
  const sev = q.get("severity");
  if (sev) c.push(sql`r.severity = ${sev}`);
  const list = await rows<AlertLogRow>(
    db,
    sql`select l.id::int as id, l.triggered_at::text as "triggeredAt", l.rule_id as "ruleId", r.name as "ruleName", r.rule_type as "ruleType",
          r.severity, e.code, e.factory, l.event_id::int as "eventId", ev.analysis_date::text as "eventDate",
          l.observed_value::float8 as "observedValue", l.message, l.delivery,
          l.acknowledged_by as "acknowledgedBy", l.acknowledged_at::text as "acknowledgedAt", l.resolved_at::text as "resolvedAt"
        from ems_alert_log l join ems_alert_rule r on r.id = l.rule_id
        left join ems_equipment e on e.id = l.equipment_id
        left join ems_downtime_event ev on ev.id = l.event_id
        where ${sql.join(c, sql` and `)}
        order by l.triggered_at desc limit ${Math.min(Number(q.get("limit") ?? 300), 1000)}`,
  );
  const channels = await rows<{ id: number; name: string; channelType: string }>(
    db,
    sql`select id, name, channel_type as "channelType" from ems_alert_channel`,
  );
  return { items: list, channels };
});
