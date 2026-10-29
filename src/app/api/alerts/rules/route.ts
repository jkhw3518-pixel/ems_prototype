import { body, handler } from "@/lib/api";
import { alertRule } from "@/db/schema";
import { audit, listRules, setRuleChannels, validateRule, type RuleInput } from "@/lib/alerts/admin";

export const GET = handler(async (_req, db) => listRules(db));

export const POST = handler(async (req, db) => {
  const b = await body<RuleInput>(req);
  const v = validateRule(b);
  const [row] = await db.insert(alertRule).values(v).returning();
  await setRuleChannels(db, row.id, b.channelIds ?? []);
  await audit(db, "rule", row.id, "create", b.by, null, { ...row, channelIds: b.channelIds });
  return row;
});
