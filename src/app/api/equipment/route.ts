import { asc } from "drizzle-orm";
import { body, handler, HttpError } from "@/lib/api";
import { equipment } from "@/db/schema";
import { normalizeCode } from "@/lib/parsers";

export const GET = handler(async (_req, db) => db.select().from(equipment).orderBy(asc(equipment.displayOrder)));

export const POST = handler(async (req, db) => {
  const b = await body<{ code: string; factory: string; group: string; displayOrder?: number }>(req);
  if (!b.code || !b.factory || !b.group) throw new HttpError(400, "code, factory, group 은 필수입니다");
  const [row] = await db
    .insert(equipment)
    .values({ code: normalizeCode(b.code), factory: b.factory, group: b.group, displayOrder: b.displayOrder ?? 999 })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new HttpError(409, "이미 존재하는 설비 코드입니다");
  return row;
});
