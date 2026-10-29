import { handler, qs, requireDate, type P } from "@/lib/api";
import { getEquipmentDetail } from "@/lib/queries/equipment";

export const GET = handler<P<"code">>(async (req, db, { params }) => {
  const code = decodeURIComponent((await params).code);
  const d = qs(req).get("date");
  return getEquipmentDetail(db, code, d ? requireDate(d) : null);
});
