import { body, handler } from "@/lib/api";
import { validateRule, type RuleInput } from "@/lib/alerts/admin";
import { previewRule } from "@/lib/alerts/evaluate";

/** 저장 전 규칙 미리보기: 최근 7일 데이터에 적용했다면 몇 건 발생했을지 */
export const POST = handler(async (req, db) => {
  const b = await body<RuleInput & { id?: number }>(req);
  const v = validateRule(b);
  const now = new Date();
  return previewRule(db, { ...v, id: b.id ?? -1, createdAt: now, updatedAt: now });
});
