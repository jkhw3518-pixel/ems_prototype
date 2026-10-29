import { eq, sql } from "drizzle-orm";
import { body, handler, HttpError, type P } from "@/lib/api";
import { downtimeCause } from "@/db/schema";
import { recomputePlanned } from "@/lib/engine/analyze";
import { rows } from "@/lib/queries/common";

/** 원인 수정 (이름/색상/계획정지 여부/비활성화). 삭제는 지원하지 않음 — 과거 기록 보존 */
export const PUT = handler<P<"code">>(async (req, db, { params }) => {
  const code = decodeURIComponent((await params).code);
  const b = await body<Partial<{ name: string; color: string; isPlanned: boolean; active: boolean; applyToCategory: boolean }>>(req);
  const [cur] = await db.select().from(downtimeCause).where(eq(downtimeCause.code, code));
  if (!cur) throw new HttpError(404, "원인 없음");
  if (b.color && !/^#[0-9a-fA-F]{6}$/.test(b.color)) throw new HttpError(400, "색상은 #RRGGBB 형식");

  // 계획 여부/색상은 대분류 단위로 일괄 적용할 수 있다
  const where = b.applyToCategory ? eq(downtimeCause.category, cur.category) : eq(downtimeCause.code, code);
  if (b.applyToCategory) await db.update(downtimeCause).set({ color: b.color, isPlanned: b.isPlanned }).where(where);
  const [row] = await db
    .update(downtimeCause)
    .set({ name: b.name?.trim() || undefined, color: b.color, isPlanned: b.isPlanned, active: b.active })
    .where(eq(downtimeCause.code, code))
    .returning();

  if (b.isPlanned !== undefined && b.isPlanned !== cur.isPlanned) {
    // 계획정지 여부 변경 → 해당 원인이 쓰인 일자의 계획정지 분 재계산
    const pairs = await rows<{ date: string; equipmentId: number }>(
      db,
      sql`select distinct e.analysis_date::text as date, e.equipment_id as "equipmentId" from ems_downtime_event e
          join ems_downtime_cause c on c.code = e.cause_code where ${b.applyToCategory ? sql`c.category = ${cur.category}` : sql`c.code = ${code}`}`,
    );
    await recomputePlanned(db, pairs);
  }
  return row;
});
