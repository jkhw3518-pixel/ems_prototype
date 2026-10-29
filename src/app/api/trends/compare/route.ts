import { handler, qs, requireDate } from "@/lib/api";
import { compareAll } from "@/lib/queries/trends";

/** ?date=YYYY-MM-DD&basis=dod|wow|mom&excludePlanned=true */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  const basis = q.get("basis");
  return compareAll(
    db,
    requireDate(q.get("date")),
    basis === "wow" || basis === "mom" ? basis : "dod",
    q.get("excludePlanned") === "true",
  );
});
