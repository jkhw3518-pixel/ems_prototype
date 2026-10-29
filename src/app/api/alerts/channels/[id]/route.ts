import { eq } from "drizzle-orm";
import { body, handler, HttpError, qs, type P } from "@/lib/api";
import { alertChannel, alertRuleChannel } from "@/db/schema";
import { audit, validateChannel, type ChannelInput } from "@/lib/alerts/admin";

export const PUT = handler<P<"id">>(async (req, db, { params }) => {
  const id = Number((await params).id);
  const [before] = await db.select().from(alertChannel).where(eq(alertChannel.id, id));
  if (!before) throw new HttpError(404, "채널 없음");
  const b = await body<Partial<ChannelInput>>(req);
  const v = validateChannel({ channelType: before.channelType, name: before.name, ...b } as ChannelInput, false);
  const targetChanged = !!v.target;
  const [row] = await db
    .update(alertChannel)
    .set({
      name: v.name,
      active: b.active ?? before.active,
      ...(targetChanged ? { target: v.target, verifiedAt: null } : {}),
    })
    .where(eq(alertChannel.id, id))
    .returning();
  if (b.ruleIds) {
    await db.delete(alertRuleChannel).where(eq(alertRuleChannel.channelId, id));
    for (const rid of new Set(b.ruleIds)) await db.insert(alertRuleChannel).values({ ruleId: rid, channelId: id }).onConflictDoNothing();
  }
  await audit(db, "channel", id, "update", b.by, before, { ...row, ruleIds: b.ruleIds });
  return { id };
});

export const DELETE = handler<P<"id">>(async (req, db, { params }) => {
  const id = Number((await params).id);
  const [before] = await db.select().from(alertChannel).where(eq(alertChannel.id, id));
  if (!before) throw new HttpError(404, "채널 없음");
  await db.delete(alertChannel).where(eq(alertChannel.id, id));
  await audit(db, "channel", id, "delete", qs(req).get("by") ?? undefined, before, null);
  return { deleted: id };
});
