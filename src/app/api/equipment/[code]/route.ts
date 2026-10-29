import { eq } from "drizzle-orm";
import { body, handler, HttpError, type P } from "@/lib/api";
import { equipment } from "@/db/schema";

export const PUT = handler<P<"code">>(async (req, db, { params }) => {
  const code = decodeURIComponent((await params).code);
  const b = await body<Partial<{ factory: string; group: string; displayOrder: number; active: boolean }>>(req);
  const [row] = await db
    .update(equipment)
    .set({ factory: b.factory, group: b.group, displayOrder: b.displayOrder, active: b.active })
    .where(eq(equipment.code, code))
    .returning();
  if (!row) throw new HttpError(404, "설비 없음");
  return row;
});
