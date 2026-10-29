import { handler, qs, requireDate } from "@/lib/api";
import { heatmap } from "@/lib/queries/causes";

export const GET = handler(async (req, db) => {
  const q = qs(req);
  return heatmap(db, {
    from: requireDate(q.get("from"), "from"),
    to: requireDate(q.get("to"), "to"),
    factory: q.get("factory"),
    equipment: q.get("equipment"),
  });
});
