import { createHmac, randomBytes } from "crypto";
import { SEVERITY_LABEL } from "../constants";
import { decrypt } from "./crypto";

export type AlertMessage = {
  severity: "info" | "warning" | "critical";
  title: string; // "PET-3 완전정지 72분 지속"
  equipment?: string;
  typeLabel: string;
  valueText: string;
  at: string; // KST 표시 문자열
  lines: string[];
  link: string;
  ackLink?: string;
};

export type ChannelRecord = { id: number; channelType: string; name: string; target: string };

const EMOJI = { info: "🔵", warning: "🟠", critical: "🔴" } as const;

export function appUrl(path = "") {
  const base = process.env.APP_BASE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return base.replace(/\/$/, "") + path;
}

async function sendSlack(webhook: string, m: AlertMessage) {
  const body = {
    text: `${EMOJI[m.severity]} [${m.severity.toUpperCase()}] ${m.title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${EMOJI[m.severity]} *[${m.severity.toUpperCase()}] ${m.title}*` } },
      { type: "section", text: { type: "mrkdwn", text: m.lines.map((l) => `• ${l}`).join("\n") } },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "설비 상세 보기" }, url: m.link },
          ...(m.ackLink ? [{ type: "button", text: { type: "plain_text", text: "알림 확인" }, url: m.ackLink }] : []),
        ],
      },
    ],
  };
  const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendEmail(to: string, m: AlertMessage) {
  const subject = `[새한프라텍 설비 알림][${SEVERITY_LABEL[m.severity]}] ${m.title}`;
  const html = `<div style="font-family:sans-serif">
    <h3 style="margin:0 0 8px">${EMOJI[m.severity]} ${escapeHtml(m.title)}</h3>
    <ul>${m.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
    <p><a href="${m.link}">설비 상세 보기</a>${m.ackLink ? ` · <a href="${m.ackLink}">알림 확인</a>` : ""}</p></div>`;
  const text = `${m.title}\n${m.lines.join("\n")}\n${m.link}`;

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? "EMS <onboarding@resend.dev>", to: [to], subject, html, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (!process.env.SMTP_HOST) throw new Error("이메일 설정 누락 (SMTP_HOST 또는 RESEND_API_KEY)");
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER, to, subject, html, text });
}

/** 카카오 알림톡 — Solapi 발송 대행 API (사전 승인 템플릿 필요) */
async function sendKakao(phone: string, m: AlertMessage) {
  const { KAKAO_API_KEY, KAKAO_API_SECRET, KAKAO_PF_ID, KAKAO_TEMPLATE_ID, KAKAO_SENDER } = process.env;
  if (!KAKAO_API_KEY || !KAKAO_API_SECRET || !KAKAO_PF_ID || !KAKAO_TEMPLATE_ID)
    throw new Error("카카오 알림톡 설정 누락 (KAKAO_API_KEY/SECRET/PF_ID/TEMPLATE_ID)");
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", KAKAO_API_SECRET).update(date + salt).digest("hex");
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      authorization: `HMAC-SHA256 apiKey=${KAKAO_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        to: phone.replace(/\D/g, ""),
        from: KAKAO_SENDER?.replace(/\D/g, ""),
        kakaoOptions: {
          pfId: KAKAO_PF_ID,
          templateId: KAKAO_TEMPLATE_ID,
          variables: {
            "#{설비}": m.equipment ?? "-",
            "#{유형}": m.typeLabel,
            "#{값}": m.valueText,
            "#{시각}": m.at,
            "#{링크}": m.link,
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Solapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 채널 발송 (실패 시 지수 백오프 3회 재시도) */
export async function deliver(ch: ChannelRecord, m: AlertMessage): Promise<{ ok: boolean; error?: string; attempts: number; dryRun?: boolean }> {
  if (process.env.ALERT_DRY_RUN === "true") {
    console.log(`[alert:dry-run] ${ch.channelType}:${ch.name} ← ${m.title}`);
    return { ok: true, attempts: 1, dryRun: true };
  }
  let target: string;
  try {
    target = decrypt(ch.target);
  } catch {
    return { ok: false, error: "target 복호화 실패 (ALERT_SECRET_KEY 확인)", attempts: 0 };
  }
  let lastErr = "";
  for (let i = 0; i < 4; i++) {
    try {
      if (ch.channelType === "slack") await sendSlack(target, m);
      else if (ch.channelType === "email") await sendEmail(target, m);
      else if (ch.channelType === "kakao") await sendKakao(target, m);
      else throw new Error(`알 수 없는 채널 유형: ${ch.channelType}`);
      return { ok: true, attempts: i + 1 };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (/설정 누락|알 수 없는/.test(lastErr)) break; // 재시도해도 소용없는 오류
      if (i < 3) await sleep(300 * 2 ** i);
    }
  }
  return { ok: false, error: lastErr, attempts: 4 };
}
