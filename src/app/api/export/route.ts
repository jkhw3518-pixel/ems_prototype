import { handler, qs, requireDate } from "@/lib/api";
import { buildReport, xlsxResponse } from "@/lib/export";

/** GET /api/export?from&to&type=daily|weekly|monthly&factory */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  const from = requireDate(q.get("from"), "from");
  const to = requireDate(q.get("to") ?? from, "to");
  const t = q.get("type");
  const type = t === "weekly" || t === "monthly" ? t : "daily";
  const buf = await buildReport(db, { from, to, type, factory: q.get("factory") });
  return xlsxResponse(buf, `비가동분석_${type}_${from}${from !== to ? `_${to}` : ""}.xlsx`);
});
