import { handler, qs, requireDate } from "@/lib/api";
import { utilizationTrend } from "@/lib/queries/trends";
import { latestAnalysisDate } from "@/lib/queries/common";
import type { Granularity } from "@/lib/time";

/** ?granularity=day|week|month&from&to&equipment=PET-1,PET-2&factory&excludePlanned=true&aggregate=factory|group&sameElapsed=true */
export const GET = handler(async (req, db) => {
  const q = qs(req);
  const g = (["day", "week", "month"].includes(q.get("granularity") ?? "") ? q.get("granularity") : "day") as Granularity;
  const agg = q.get("aggregate");
  return utilizationTrend(db, {
    granularity: g,
    from: requireDate(q.get("from"), "from"),
    to: requireDate(q.get("to"), "to"),
    codes: q.get("equipment")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    factory: q.get("factory"),
    excludePlanned: q.get("excludePlanned") === "true",
    aggregate: agg === "factory" || agg === "group" ? agg : "equipment",
    sameElapsed: q.get("sameElapsed") === "true",
    latestDate: await latestAnalysisDate(db),
  });
});
