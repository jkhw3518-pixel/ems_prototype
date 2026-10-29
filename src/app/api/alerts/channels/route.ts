import { body, handler } from "@/lib/api";
import { alertChannel, alertRuleChannel } from "@/db/schema";
import { audit, listChannels, validateChannel, type ChannelInput } from "@/lib/alerts/admin";
import { failingChannels } from "@/lib/alerts/evaluate";

export const GET = handler(async (_req, db) => listChannels(db, await failingChannels(db)));

export const POST = handler(async (req, db) => {
  const b = await body<ChannelInput>(req);
  const v = validateChannel(b, true);
  const [row] = await db.insert(alertChannel).values({ ...v, target: v.target! }).returning();
  for (const rid of b.ruleIds ?? []) await db.insert(alertRuleChannel).values({ ruleId: rid, channelId: row.id }).onConflictDoNothing();
  await audit(db, "channel", row.id, "create", b.by, null, { ...row, ruleIds: b.ruleIds });
  return { id: row.id };
});
