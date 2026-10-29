import { handler, qs, requireDate, type P } from "@/lib/api";
import { getDashboard } from "@/lib/queries/dashboard";

export const GET = handler<P<"date">>(async (req, db, { params }) => {
  const date = requireDate((await params).date);
  return getDashboard(db, date, qs(req).get("factory"));
});
