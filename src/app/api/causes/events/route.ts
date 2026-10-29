import { handler, qs, requireDate } from "@/lib/api";
import { eventsByCause, unclassifiedInbox } from "@/lib/queries/causes";

/** 드릴다운 구간 목록 (?category | ?cause) 또는 미분류 작업함 (?unclassified=1) */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  const f = {
    from: requireDate(q.get("from"), "from"),
    to: requireDate(q.get("to"), "to"),
    factory: q.get("factory"),
    equipment: q.get("equipment"),
  };
  if (q.get("unclassified")) return unclassifiedInbox(db, { ...f, limit: Number(q.get("limit") ?? 100) });
  return eventsByCause(db, { ...f, category: q.get("category"), cause: q.get("cause") });
});
