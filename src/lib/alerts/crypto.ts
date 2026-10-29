import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// 채널 webhook URL 등 민감한 target 은 AES-256-GCM 으로 암호화해 DB 에 저장 (§3.9)
const PREFIX = "enc:v1:";

function key() {
  const secret = process.env.ALERT_SECRET_KEY;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("ALERT_SECRET_KEY 환경변수가 필요합니다");
  return createHash("sha256").update(secret ?? "ems-dev-only-key").digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(v: string): string {
  if (!v.startsWith(PREFIX)) return v;
  const buf = Buffer.from(v.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** 화면 표시용 마스킹 */
export function maskTarget(type: string, stored: string): string {
  let plain: string;
  try {
    plain = decrypt(stored);
  } catch {
    return "(복호화 실패 — ALERT_SECRET_KEY 확인)";
  }
  if (type === "slack") return plain.replace(/(hooks\.slack\.com\/services\/[^/]+\/)[^/]+\/.+$/, "$1••••/••••");
  if (type === "kakao") return plain.replace(/(\d{3})\d{3,4}(\d{4})/, "$1-****-$2");
  return plain;
}
