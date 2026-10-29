"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, emitChange, useApi } from "@/lib/client";
import type { criteria } from "@/db/schema";
import { Button, Card, CardHeader, ErrorBox, Input, Spinner } from "../ui";

type Crit = typeof criteria.$inferSelect;

export function CriteriaTab() {
  const q = useApi<Crit[]>("/api/criteria");
  const [edit, setEdit] = useState<Record<string, { stop: string; idle: string; dur: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (c: Crit) => {
    const e = edit[c.group];
    setErr(null);
    try {
      await api(`/api/criteria/${encodeURIComponent(c.group)}`, {
        method: "PUT",
        json: { stopThreshold: Number(e.stop), idleThreshold: Number(e.idle), durationMin: Number(e.dur) },
      });
      setEdit(({ [c.group]: _, ...rest }) => rest);
      setMsg(`${c.group} 기준 저장됨 — 과거 날짜에 반영하려면 '전체 재분석'을 실행하세요.`);
      q.reload();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  };

  const reanalyze = async () => {
    setBusy(true);
    setMsg("전체 재분석 중… (원인 분류 기록은 유지됩니다)");
    try {
      const r = await api<{ results: { date: string; error?: string }[] }>("/api/analyze", { method: "POST", json: { all: true, alerts: false } });
      const failed = r.results.filter((x) => x.error);
      setMsg(`${r.results.length}일 재분석 완료${failed.length ? ` (실패 ${failed.length}일)` : ""}`);
      emitChange();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  if (!q.data) return <Spinner />;
  return (
    <Card>
      <CardHeader
        title="설비 그룹별 전류 판정 기준"
        desc="전류 ≤ 완전정지 → 완전정지 · 완전정지 < 전류 ≤ 비가동 상한 이 지속 조건 이상 이어지면 → 비가동 · 그 외 정상가동"
        right={
          <Button variant="outline" onClick={reanalyze} disabled={busy}>
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> 전체 재분석
          </Button>
        }
      />
      {msg && <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-sm text-zinc-700">{msg}</div>}
      {err && <div className="p-3"><ErrorBox error={err} /></div>}
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2">그룹</th>
            <th className="px-2 py-2">완전정지 (A)</th>
            <th className="px-2 py-2">비가동 상한 (A)</th>
            <th className="px-2 py-2">지속 조건 (분)</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c) => {
            const e = edit[c.group];
            const set = (k: "stop" | "idle" | "dur", v: string) =>
              setEdit((s) => ({ ...s, [c.group]: { ...(s[c.group] ?? { stop: String(c.stopThreshold), idle: String(c.idleThreshold), dur: String(c.durationMin) }), [k]: v } }));
            return (
              <tr key={c.group} className="border-t border-zinc-100">
                <td className="px-4 py-2 font-medium">{c.group}</td>
                <td className="px-2 py-1.5"><Input type="number" step="0.5" className="w-24" value={e?.stop ?? c.stopThreshold} onChange={(x) => set("stop", x.target.value)} /></td>
                <td className="px-2 py-1.5"><Input type="number" step="0.5" className="w-24" value={e?.idle ?? c.idleThreshold} onChange={(x) => set("idle", x.target.value)} /></td>
                <td className="px-2 py-1.5"><Input type="number" className="w-20" value={e?.dur ?? c.durationMin} onChange={(x) => set("dur", x.target.value)} /></td>
                <td className="px-4 py-1.5 text-right">
                  {e && (
                    <span className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => save(c)}>저장</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(({ [c.group]: _, ...rest }) => rest)}>취소</Button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
