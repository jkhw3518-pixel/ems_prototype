import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { downtimeCause, downtimeEvent } from "@/db/schema";
import { HttpError } from "./api";
import { recomputePlanned } from "./engine/analyze";

/** 비가동 구간 원인 기록. causeCode=null 이면 분류 해제 */
export async function classifyEvents(
  db: DB,
  ids: number[],
  input: { causeCode?: string | null; memo?: string | null; by?: string | null; source: "manual" | "suggested" | "bulk" },
) {
  if (!ids.length) throw new HttpError(400, "대상 구간이 없습니다");
  const events = await db.select().from(downtimeEvent).where(inArray(downtimeEvent.id, ids));
  if (events.length !== ids.length) throw new HttpError(404, "일부 구간을 찾을 수 없습니다 (재분석으로 변경되었을 수 있음)");

  const set: Partial<typeof downtimeEvent.$inferInsert> = {};
  if (input.causeCode !== undefined) {
    if (input.causeCode) {
      const [c] = await db.select().from(downtimeCause).where(eq(downtimeCause.code, input.causeCode));
      if (!c) throw new HttpError(400, `알 수 없는 원인 코드: ${input.causeCode}`);
      if (!c.active) throw new HttpError(400, "비활성화된 원인입니다");
      if (c.code === "ETC") {
        const memoOk = (input.memo ?? "").trim() || events.every((e) => (e.memo ?? "").trim());
        if (!memoOk) throw new HttpError(400, "'기타' 원인은 메모가 필수입니다");
      }
      Object.assign(set, { causeCode: c.code, causeSource: input.source, classifiedBy: input.by || null, classifiedAt: new Date() });
    } else {
      Object.assign(set, { causeCode: null, causeSource: null, classifiedBy: null, classifiedAt: null });
    }
  }
  if (input.memo !== undefined) set.memo = input.memo?.trim() || null;

  await db.update(downtimeEvent).set(set).where(inArray(downtimeEvent.id, ids));
  await recomputePlanned(db, events.map((e) => ({ date: e.analysisDate, equipmentId: e.equipmentId })));
  return { updated: ids.length };
}
