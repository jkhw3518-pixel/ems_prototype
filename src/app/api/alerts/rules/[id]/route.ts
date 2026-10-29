import { eq } from "drizzle-orm";
import { body, handler, HttpError, qs, type P } from "@/lib/api";
import { alertRule } from "@/db/schema";
import type { DB } from "@/db";
import { audit, listRules, setRuleChannels, validateRule, type RuleInput } from "@/lib/alerts/admin";

async function current(db: DB, id: number) {
  const r = (await listRules(db)).find((x) => x.id === id);
  if (!r) throw new HttpError(404, "규칙 없음");
  return r;
}

export const PUT = handler<P<"id">>(async (req, db, { params }) => {
  const id = Number((await params).id);
  const before = await current(db, id);
  const b = await body<Partial<RuleInput>>(req);
  // 활성 토글 같은 부분 수정 지원
  const v = validateRule({ ...before, threshold: Number(before.threshold), ...b } as RuleInput);
  const [row] = await db.update(alertRule).set({ ...v, updatedAt: new Date() }).where(eq(alertRule.id, id)).returning();
  await setRuleChannels(db, id, b.channelIds);
  await audit(db, "rule", id, "update", b.by, before, { ...row, channelIds: b.channelIds ?? before.channelIds });
  return row;
});

export const DELETE = handler<P<"id">>(async (req, db, { params }) => {
  const id = Number((await params).id);
  const before = await current(db, id);
  await db.delete(alertRule).where(eq(alertRule.id, id));
  await audit(db, "rule", id, "delete", qs(req).get("by") ?? undefined, before, null);
  return { deleted: id };
});
