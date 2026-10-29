import { sql, type SQL } from "drizzle-orm";
import { body, handler, HttpError, qs, requireDate, type P } from "@/lib/api";
import { rows } from "@/lib/queries/common";
import { EVENT_SELECT, type EventRow } from "@/lib/queries/dashboard";
import { classifyEvents } from "@/lib/classify-events";

/** GET /api/events/:date?equipment=PET-1&cause=unclassified|classified|<code>&factory=1공장 */
export const GET = handler<P<"param">>(async (req, db, { params }) => {
  const date = requireDate((await params).param);
  const q = qs(req);
  const c: SQL[] = [sql`ev.analysis_date = ${date}`];
  const eq = q.get("equipment");
  if (eq) c.push(sql`e.code in (${sql.join(eq.split(",").map((x) => sql`${x}`), sql`, `)})`);
  const f = q.get("factory");
  if (f) c.push(sql`e.factory = ${f}`);
  const cause = q.get("cause");
  if (cause === "unclassified") c.push(sql`ev.cause_code is null`);
  else if (cause === "classified") c.push(sql`ev.cause_code is not null`);
  else if (cause) c.push(sql`ev.cause_code = ${cause}`);
  return rows<EventRow>(db, sql`${EVENT_SELECT} where ${sql.join(c, sql` and `)} order by e.display_order, ev.start_minute`);
});

/** PATCH /api/events/:id  { cause_code?, memo?, by? } */
export const PATCH = handler<P<"param">>(async (req, db, { params }) => {
  const id = Number((await params).param);
  if (!Number.isInteger(id)) throw new HttpError(400, "id 가 올바르지 않습니다");
  const b = await body<{ cause_code?: string | null; causeCode?: string | null; memo?: string | null; by?: string }>(req);
  const code = b.cause_code !== undefined ? b.cause_code : b.causeCode;
  return classifyEvents(db, [id], { causeCode: code, memo: b.memo, by: b.by, source: "manual" });
});
