import { body, handler, HttpError, type P } from "@/lib/api";
import { criteria } from "@/db/schema";

export const PUT = handler<P<"group">>(async (req, db, { params }) => {
  const group = decodeURIComponent((await params).group);
  const b = await body<{ stopThreshold: number; idleThreshold: number; durationMin: number }>(req);
  const stop = Number(b.stopThreshold);
  const idle = Number(b.idleThreshold);
  const dur = Math.round(Number(b.durationMin));
  if (!(stop >= 0) || !(idle > stop) || !(dur >= 1)) throw new HttpError(400, "완전정지 < 비가동 상한, 지속 조건 ≥ 1분 이어야 합니다");
  const [row] = await db
    .insert(criteria)
    .values({ group, stopThreshold: stop, idleThreshold: idle, durationMin: dur })
    .onConflictDoUpdate({ target: criteria.group, set: { stopThreshold: stop, idleThreshold: idle, durationMin: dur, updatedAt: new Date() } })
    .returning();
  return row;
});
