import { handler, qs, requireDate } from "@/lib/api";
import { pareto } from "@/lib/queries/causes";

/** ?from&to&factory&equipment&level=category|cause&category=BREAKDOWN */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  return pareto(db, {
    from: requireDate(q.get("from"), "from"),
    to: requireDate(q.get("to"), "to"),
    factory: q.get("factory"),
    equipment: q.get("equipment"),
    level: q.get("level") === "cause" ? "cause" : "category",
    category: q.get("category"),
  });
});
