"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

/** GET 요청 훅. url 이 null 이면 대기 */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(url);
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

const OP_KEY = "ems.operator";
export function getOperator(): string {
  try {
    return localStorage.getItem(OP_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setOperator(v: string) {
  try {
    localStorage.setItem(OP_KEY, v);
    window.dispatchEvent(new Event("ems-operator"));
  } catch {}
}

export function useOperator() {
  const [op, setOp] = useState("");
  useEffect(() => {
    setOp(getOperator());
    const f = () => setOp(getOperator());
    window.addEventListener("ems-operator", f);
    return () => window.removeEventListener("ems-operator", f);
  }, []);
  return op;
}

/** 다른 화면에서 데이터가 바뀌었음을 알림 (헤더 배지 갱신 등) */
export function emitChange() {
  window.dispatchEvent(new Event("ems-change"));
}
