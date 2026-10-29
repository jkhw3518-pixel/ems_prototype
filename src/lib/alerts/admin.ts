import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { alertAudit, alertChannel, alertRule, alertRuleChannel } from "@/db/schema";
import { HttpError } from "../api";
import { encrypt, maskTarget } from "./crypto";

export type RuleInput = {
  name: string;
  ruleType: string;
  scopeType: string;
  scopeValue?: string | null;
  threshold: number;
  period?: string | null;
  severity: string;
  cooldownMin?: number;
  quietStart?: string | null;
  quietEnd?: string | null;
  excludePlanned?: boolean;
  active?: boolean;
  channelIds?: number[];
  by?: string;
};

const TYPES = ["UTIL_BELOW", "UTIL_DROP", "STOP_DURATION", "IDLE_DURATION"];
const SCOPES = ["all", "factory", "group", "equipment"];
const SEVERITIES = ["info", "warning", "critical"];
const PERIODS = ["day", "week", "rolling_2h"];

export function validateRule(b: RuleInput) {
  if (!b.name?.trim()) throw new HttpError(400, "규칙 이름이 필요합니다");
  if (!TYPES.includes(b.ruleType)) throw new HttpError(400, "규칙 유형이 올바르지 않습니다");
  if (!SCOPES.includes(b.scopeType)) throw new HttpError(400, "적용 범위가 올바르지 않습니다");
  if (b.scopeType !== "all" && !b.scopeValue?.trim()) throw new HttpError(400, "적용 대상을 선택하세요");
  if (!SEVERITIES.includes(b.severity)) throw new HttpError(400, "심각도가 올바르지 않습니다");
  const th = Number(b.threshold);
  if (!Number.isFinite(th) || th <= 0) throw new HttpError(400, "임계치는 0보다 커야 합니다");
  if (b.ruleType === "UTIL_BELOW" && th > 1) throw new HttpError(400, "가동율 임계치는 0~1 비율 (예: 0.8)");
  const period = b.ruleType.startsWith("UTIL") ? (b.period ?? "day") : null;
  if (period && !PERIODS.includes(period)) throw new HttpError(400, "기간이 올바르지 않습니다");
  if (b.ruleType === "UTIL_DROP" && period === "rolling_2h") throw new HttpError(400, "급락 규칙은 일/주 단위만 지원");
  const t = (v?: string | null) => (v && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v : null);
  return {
    name: b.name.trim(),
    ruleType: b.ruleType,
    scopeType: b.scopeType,
    scopeValue: b.scopeType === "all" ? null : b.scopeValue!.trim(),
    threshold: th,
    period,
    severity: b.severity,
    cooldownMin: Math.max(0, Math.round(Number(b.cooldownMin ?? 60))),
    quietStart: t(b.quietStart),
    quietEnd: t(b.quietEnd),
    excludePlanned: b.excludePlanned ?? true,
    active: b.active ?? true,
  };
}

export async function audit(db: DB, entity: "rule" | "channel", id: number, action: string, by: string | undefined, before: unknown, after: unknown) {
  await db.insert(alertAudit).values({
    entity, entityId: id, action, changedBy: by || null,
    beforeValue: before ? sanitize(before) : null,
    afterValue: after ? sanitize(after) : null,
  });
}

// 비밀값은 이력에 남기지 않는다
function sanitize(v: unknown) {
  const o = { ...(v as Record<string, unknown>) };
  if (typeof o.target === "string" && o.target.startsWith("enc:")) o.target = "(encrypted)";
  return o;
}

export async function setRuleChannels(db: DB, ruleId: number, ids: number[] | undefined) {
  if (!ids) return;
  await db.delete(alertRuleChannel).where(eq(alertRuleChannel.ruleId, ruleId));
  for (const cid of new Set(ids)) await db.insert(alertRuleChannel).values({ ruleId, channelId: cid }).onConflictDoNothing();
}

export async function listRules(db: DB) {
  const rules = await db.select().from(alertRule).orderBy(alertRule.id);
  const links = await db.select().from(alertRuleChannel);
  return rules.map((r) => ({ ...r, channelIds: links.filter((l) => l.ruleId === r.id).map((l) => l.channelId) }));
}

export type ChannelInput = { channelType: string; name: string; target?: string; active?: boolean; ruleIds?: number[]; by?: string };

export function validateChannel(b: ChannelInput, requireTarget: boolean) {
  if (!["email", "slack", "kakao"].includes(b.channelType)) throw new HttpError(400, "채널 유형은 email/slack/kakao");
  if (!b.name?.trim()) throw new HttpError(400, "채널 이름이 필요합니다");
  const target = b.target?.trim();
  if (requireTarget && !target) throw new HttpError(400, "수신 대상이 필요합니다");
  if (target) {
    if (b.channelType === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) throw new HttpError(400, "이메일 형식이 올바르지 않습니다");
    if (b.channelType === "slack" && !/^https:\/\/hooks\.slack\.com\//.test(target)) throw new HttpError(400, "Slack Incoming Webhook URL 이 필요합니다");
    if (b.channelType === "kakao" && !/^01\d[-\s]?\d{3,4}[-\s]?\d{4}$/.test(target)) throw new HttpError(400, "휴대폰 번호 형식이 올바르지 않습니다");
  }
  return {
    channelType: b.channelType,
    name: b.name.trim(),
    // webhook URL 은 암호화 저장, 전화번호도 개인정보이므로 암호화
    target: target ? (b.channelType === "email" ? target : encrypt(target)) : undefined,
    active: b.active ?? true,
  };
}

export async function listChannels(db: DB, failing: number[]) {
  const chs = await db.select().from(alertChannel).orderBy(alertChannel.id);
  const links = await db.select().from(alertRuleChannel);
  return chs.map((c) => ({
    id: c.id,
    channelType: c.channelType,
    name: c.name,
    target: maskTarget(c.channelType, c.target),
    active: c.active,
    verifiedAt: c.verifiedAt,
    createdAt: c.createdAt,
    ruleIds: links.filter((l) => l.channelId === c.id).map((l) => l.ruleId),
    failing: failing.includes(c.id),
  }));
}
