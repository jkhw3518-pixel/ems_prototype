import { and, eq, isNull } from "drizzle-orm";
import { body, handler, type P } from "@/lib/api";
import { alertLog } from "@/db/schema";

export const POST = handler<P<"id">>(async (req, db, { params }) => {
  const id = Number((await params).id);
  const b = await body<{ by?: string }>(req).catch(() => ({}) as { by?: string });
  const [row] = await db
    .update(alertLog)
    .set({ acknowledgedBy: b.by?.trim() || "담당자", acknowledgedAt: new Date() })
    .where(and(eq(alertLog.id, id), isNull(alertLog.acknowledgedAt)))
    .returning({ id: alertLog.id });
  return { acknowledged: !!row };
});
