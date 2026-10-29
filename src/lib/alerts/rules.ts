import type { alertRule, equipment } from "@/db/schema";

type Rule = typeof alertRule.$inferSelect;
type Equip = Pick<typeof equipment.$inferSelect, "code" | "factory" | "group">;

const SPECIFICITY: Record<string, number> = { all: 1, factory: 2, group: 3, equipment: 4 };

export function scopeValues(r: Pick<Rule, "scopeValue">): string[] {
  return (r.scopeValue ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function ruleMatches(r: Rule, e: Equip): boolean {
  const vals = scopeValues(r);
  switch (r.scopeType) {
    case "all": return true;
    case "factory": return vals.includes(e.factory);
    case "group": return vals.includes(e.group);
    case "equipment": return vals.includes(e.code);
    default: return false;
  }
}

/**
 * 설비에 적용되는 규칙 (§11.1): 같은 유형·기간 안에서 가장 구체적인 범위의 규칙만 남긴다.
 * (전체 범위 '주의 80%' 와 '위험 60%' 처럼 같은 구체성의 규칙은 함께 적용)
 */
export function rulesFor(rules: Rule[], e: Equip): Rule[] {
  const matched = rules.filter((r) => r.active && ruleMatches(r, e));
  const best = new Map<string, number>();
  for (const r of matched) {
    const k = `${r.ruleType}:${r.period ?? ""}`;
    best.set(k, Math.max(best.get(k) ?? 0, SPECIFICITY[r.scopeType] ?? 0));
  }
  return matched.filter((r) => SPECIFICITY[r.scopeType] === best.get(`${r.ruleType}:${r.period ?? ""}`));
}

/** 설비의 일 가동율 알림 임계치 (여러 개면 가장 높은 값 = 가장 먼저 걸리는 기준) */
export function utilThresholdFor(rules: Rule[], e: Equip, period = "day"): number | null {
  const list = rulesFor(rules, e).filter((r) => r.ruleType === "UTIL_BELOW" && (r.period ?? "day") === period);
  return list.length ? Math.max(...list.map((r) => Number(r.threshold))) : null;
}
