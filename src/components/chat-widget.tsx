"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { MessageCircle, RotateCcw, Send, X } from "lucide-react";

/** 우측 하단 플로팅 챗봇. 페이지 이동 없이 작은 창에서 대화한다. (API: /api/chatbot 프록시) */

type Msg = { role: "user" | "assistant"; text: string; sources?: string[]; error?: boolean };

const TITLE = "황준규";
const STORE_KEY = "ems-chat:bot-90bcc018";

function load(): { sessionId: string | null; messages: Msg[] } {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { sessionId: null, messages: [] };
}

/** URL 은 링크로, 줄바꿈은 그대로 — innerHTML 없이 렌더 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p.replace(/\*\*(.+?)\*\*/g, "$1")}</Fragment>
        ),
      )}
    </>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 새로고침·페이지 이동 후에도 같은 탭에서는 대화 유지
  useEffect(() => {
    const s = load();
    setMessages(s.messages);
    setSessionId(s.sessionId);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ sessionId, messages }));
    } catch {}
  }, [loaded, sessionId, messages]);

  // 처음 열 때 추천 질문 로드
  useEffect(() => {
    if (!open || suggestions.length) return;
    fetch("/api/chatbot")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.recommendedQuestions && setSuggestions(d.recommendedQuestions.slice(0, 3)))
      .catch(() => {});
  }, [open, suggestions.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const query = text.trim();
    if (!query || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: query }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sessionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.answer) throw new Error(d.error || "답변을 받지 못했습니다.");
      if (d.sessionId) setSessionId(d.sessionId);
      setMessages((m) => [...m, { role: "assistant", text: d.answer, sources: d.sources }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: (e as Error).message || "네트워크 오류가 발생했습니다.", error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function reset() {
    if (busy) return;
    setMessages([]);
    setSessionId(null);
  }

  return (
    <div className="fixed right-5 bottom-5 z-[1000] print:hidden">
      {/* 채팅 창 */}
      <div
        role="dialog"
        aria-label={`${TITLE} 챗봇`}
        aria-hidden={!open}
        className={`absolute right-0 bottom-[70px] flex h-[520px] max-h-[calc(100vh-110px)] w-[360px] max-w-[calc(100vw-40px)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-all duration-200 ${
          open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0"
        }`}
      >
        <header className="flex items-center gap-2 bg-zinc-900 px-4 py-3 text-white">
          <div className="flex size-8 items-center justify-center rounded-full bg-white/15">
            <MessageCircle className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{TITLE}</div>
            <div className="text-[11px] text-zinc-300">AI 챗봇 · 무엇이든 물어보세요</div>
          </div>
          <button onClick={reset} title="새 대화" aria-label="새 대화" className="rounded-md p-1.5 hover:bg-white/10 disabled:opacity-40" disabled={busy}>
            <RotateCcw className="size-4" />
          </button>
          <button onClick={() => setOpen(false)} title="닫기" aria-label="닫기" className="rounded-md p-1.5 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-3 py-4 text-sm">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 leading-relaxed shadow-sm">
                안녕하세요! {TITLE} 챗봇입니다. 궁금한 점을 입력해 주세요.
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-col items-start gap-1.5">
                  {suggestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="max-w-full truncate rounded-full border border-zinc-300 bg-white px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-900 px-3 py-2 leading-relaxed break-words whitespace-pre-wrap text-white">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div
                  className={`max-w-[85%] rounded-2xl rounded-tl-sm px-3 py-2 leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                    m.error ? "bg-red-50 text-red-700" : "bg-white text-zinc-800"
                  }`}
                >
                  <RichText text={m.text} />
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-500">
                      참고: {m.sources.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="flex justify-start">
              <div className="flex gap-1 rounded-2xl rounded-tl-sm bg-white px-3 py-3 shadow-sm" aria-label="답변 작성 중">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="size-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-zinc-200 bg-white p-2"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
            className="max-h-24 min-h-[38px] flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="보내기"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>

      {/* 런처 버튼 */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "챗봇 닫기" : "챗봇 열기"}
        aria-expanded={open}
        title={`${TITLE} 챗봇`}
        className="flex size-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </div>
  );
}
