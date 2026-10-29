import { eq } from "drizzle-orm";
import { body, handler, HttpError, type P } from "@/lib/api";
import { downtimeEvent } from "@/db/schema";
import { classifyEvents } from "@/lib/classify-events";

export const POST = handler<P<"param">>(async (req, db, { params }) => {
  const id = Number((await params).param);
  const b = await body<{ by?: string }>(req).catch(() => ({}) as { by?: string });
  const [ev] = await db.select().from(downtimeEvent).where(eq(downtimeEvent.id, id));
  if (!ev) throw new HttpError(404, "구간 없음");
  if (!ev.suggestedCauseCode) throw new HttpError(400, "추천 원인이 없는 구간입니다");
  return classifyEvents(db, [id], { causeCode: ev.suggestedCauseCode, by: b.by, source: "suggested" });
});
