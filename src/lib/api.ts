import { NextResponse } from "next/server";
import { getDb, type DB } from "@/db";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

/** 라우트 핸들러 공통 래퍼: DB 주입 + 오류를 JSON 으로 */
export function handler<C = unknown>(fn: (req: Request, db: DB, ctx: C) => Promise<Response | unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const db = await getDb();
      const out = await fn(req, db, ctx);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      // drizzle 은 "Failed query: ..." 로 감싸므로 실제 원인(cause)을 함께 보여준다
      const cause = e instanceof Error && e.cause instanceof Error ? ` — 원인: ${e.cause.message}` : "";
      return json({ error: e instanceof Error ? `${e.message.split("\n")[0].slice(0, 200)}${cause}` : "서버 오류" }, 500);
    }
  };
}

export type P<T extends string> = { params: Promise<Record<T, string>> };

export const qs = (req: Request) => new URL(req.url).searchParams;

export function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function requireDate(s: unknown, name = "date"): string {
  if (!isDate(s)) throw new HttpError(400, `${name} 형식은 YYYY-MM-DD 이어야 합니다`);
  return s;
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "JSON 본문이 필요합니다");
  }
}

/** Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 를 보낸다 */
export function checkCronSecret(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new HttpError(500, "CRON_SECRET 미설정");
    return;
  }
  const auth = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  if (auth !== `Bearer ${secret}` && header !== secret) throw new HttpError(401, "인증 실패");
}
