import { handler, qs, requireDate, type P } from "@/lib/api";
import { buildReport, xlsxResponse } from "@/lib/export";

export const GET = handler<P<"date">>(async (req, db, { params }) => {
  const date = requireDate((await params).date);
  const buf = await buildReport(db, { from: date, to: date, type: "daily", factory: qs(req).get("factory") });
  return xlsxResponse(buf, `비가동분석_${date}.xlsx`);
});
