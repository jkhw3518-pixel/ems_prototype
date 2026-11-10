import { NextResponse } from "next/server";

/**
 * 챗봇 프록시.
 * chatbot.aiconvergencelab.com 은 외부 사이트의 iframe 임베드(frame-ancestors 'self')와
 * 브라우저 CORS 요청을 모두 막기 때문에, 우리 서버가 대신 호출해 같은 출처로 돌려준다.
 */
const HOST = "https://chatbot.aiconvergencelab.com";
const SLUG = process.env.CHATBOT_SLUG || "bot-90bcc018";

export const dynamic = "force-dynamic";

type Envelope<T> = { success?: boolean; message?: string; data?: T };
type BotInfo = { botId: string; name?: string; sourceExpose?: boolean; recommendedQuestions?: { id: string; question: string }[] };

let cachedBot: { info: BotInfo; at: number } | null = null;

async function getBot(): Promise<BotInfo> {
  if (cachedBot && Date.now() - cachedBot.at < 10 * 60_000) return cachedBot.info;
  const res = await fetch(`${HOST}/api/v1/public/bots/${encodeURIComponent(SLUG)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const env = (await res.json().catch(() => null)) as Envelope<BotInfo> | null;
  if (!res.ok || !env?.data?.botId) throw new Error("챗봇 정보를 불러오지 못했습니다.");
  cachedBot = { info: env.data, at: Date.now() };
  return env.data;
}

/** 위젯 초기화용: 봇 이름, 추천 질문 */
export async function GET() {
  try {
    const bot = await getBot();
    return NextResponse.json({
      name: bot.name ?? "챗봇",
      sourceExpose: !!bot.sourceExpose,
      recommendedQuestions: (bot.recommendedQuestions ?? []).map((q) => q.question),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 질문 전송: { query, sessionId? } → { answer, sessionId, sources } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { query?: unknown; sessionId?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "질문을 입력해 주세요." }, { status: 400 });
  if (query.length > 2000) return NextResponse.json({ error: "질문이 너무 깁니다. (최대 2000자)" }, { status: 400 });
  const sessionId = typeof body?.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId : null;

  try {
    const bot = await getBot();
    const res = await fetch(`${HOST}/api/v1/rag/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({ botId: bot.botId, query, sessionId, channel: "web" }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const env = (await res.json().catch(() => null)) as Envelope<{
      answer?: string;
      sessionId?: string;
      sources?: { title?: string; fileName?: string }[];
    }> | null;
    if (!res.ok || !env?.data?.answer) {
      return NextResponse.json({ error: "답변을 받지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
    }
    return NextResponse.json({
      answer: env.data.answer,
      sessionId: env.data.sessionId ?? sessionId,
      sources: bot.sourceExpose
        ? (env.data.sources ?? []).map((s) => s.title || s.fileName).filter((s): s is string => !!s)
        : [],
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError";
    return NextResponse.json(
      { error: timeout ? "응답 시간이 초과되었습니다. 다시 시도해 주세요." : "챗봇 서버에 연결할 수 없습니다." },
      { status: 502 },
    );
  }
}
