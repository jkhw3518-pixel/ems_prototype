import { inArray } from "drizzle-orm";
import { body, handler, HttpError } from "@/lib/api";
import { downtimeEvent } from "@/db/schema";
import { classifyEvents } from "@/lib/classify-events";

/** PATCH /api/events/bulk { ids:[], cause_code, memo?, by? } — acceptSuggestions:true 면 각 구간의 추천 원인으로 확정 */
export const PATCH = handler(async (req, db) => {
  const b = await body<{ ids: number[]; cause_code?: string | null; memo?: string; by?: string; acceptSuggestions?: boolean }>(req);
  const ids = (b.ids ?? []).map(Number).filter(Number.isInteger);
  if (!ids.length) throw new HttpError(400, "ids 가 필요합니다");
  if (b.acceptSuggestions) {
    const evs = await db.select().from(downtimeEvent).where(inArray(downtimeEvent.id, ids));
    const byCode = new Map<string, number[]>();
    for (const e of evs) if (e.suggestedCauseCode) byCode.set(e.suggestedCauseCode, [...(byCode.get(e.suggestedCauseCode) ?? []), e.id]);
    let updated = 0;
    for (const [code, list] of byCode) updated += (await classifyEvents(db, list, { causeCode: code, by: b.by, source: "suggested" })).updated;
    return { updated };
  }
  if (b.cause_code === undefined) throw new HttpError(400, "cause_code 가 필요합니다");
  return classifyEvents(db, ids, { causeCode: b.cause_code, memo: b.memo, by: b.by, source: "bulk" });
});
