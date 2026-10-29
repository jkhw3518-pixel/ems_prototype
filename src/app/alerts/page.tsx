"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { api, emitChange, getOperator, useApi } from "@/lib/client";
import { formatKst } from "@/lib/time";
import { cn, pct } from "@/lib/utils";
import { RULE_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/constants";
import type { AlertLogRow } from "@/app/api/alerts/log/route";
import { Badge, Button, Card, Empty, ErrorBox, Input, Segmented, Select, Spinner } from "@/components/ui";

type Status = "" | "unacked" | "open" | "acked" | "resolved";
const SEV_CLS: Record<string, string> = { critical: "bg-rose-600 text-white", warning: "bg-amber-100 text-amber-800", info: "bg-sky-100 text-sky-700" };

function observed(r: AlertLogRow) {
  if (r.observedValue == null) return "–";
  if (r.ruleType === "UTIL_BELOW") return pct(r.observedValue);
  if (r.ruleType === "UTIL_DROP") return `▼ ${r.observedValue.toFixed(1)}%p`;
  return `${r.observedValue}분`;
}

export default function AlertsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("");
  const [severity, setSeverity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s as Status);
  }, []);
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (severity) q.set("severity", severity);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const log = useApi<{ items: AlertLogRow[]; channels: { id: number; name: string; channelType: string }[] }>(`/api/alerts/log?${q}`);
  const [busy, setBusy] = useState(false);

  const ack = async (ids: number[]) => {
    setBusy(true);
    try {
      for (const id of ids) await api(`/api/alerts/log/${id}/ack`, { method: "POST", json: { by: getOperator() || undefined } });
      log.reload();
      emitChange();
    } finally {
      setBusy(false);
    }
  };

  const items = log.data?.items ?? [];
  const chName = new Map((log.data?.channels ?? []).map((c) => [c.id, `${c.name}`]));
  const unacked = items.filter((i) => !i.acknowledgedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">알림 이력</h1>
        <Segmented<Status>
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "전체" },
            { value: "unacked", label: "미확인" },
            { value: "open", label: "진행 중" },
            { value: "acked", label: "확인됨" },
            { value: "resolved", label: "복구됨" },
          ]}
        />
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">심각도 전체</option>
          <option value="critical">위험</option>
          <option value="warning">경고</option>
          <option value="info">정보</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-zinc-400">~</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {unacked.length > 0 && (
          <Button className="ml-auto" variant="outline" disabled={busy} onClick={() => ack(unacked.map((i) => i.id))}>
            <CheckCheck className="h-4 w-4" /> 표시된 {unacked.length}건 모두 확인
          </Button>
        )}
      </div>
      {log.error && <ErrorBox error={log.error} />}
      <Card>
        {!log.data ? (
          <Spinner />
        ) : !items.length ? (
          <Empty>조건에 맞는 알림이 없습니다</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2">발생 시각</th>
                  <th className="px-2 py-2">설비</th>
                  <th className="px-2 py-2">규칙</th>
                  <th className="px-2 py-2 text-right">관측값</th>
                  <th className="px-2 py-2">심각도</th>
                  <th className="px-2 py-2">발송 결과</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="px-4 py-2">확인</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const href = r.code
                    ? `/equipment/${encodeURIComponent(r.code)}${r.eventDate ? `?date=${r.eventDate}&event=${r.eventId}` : ""}`
                    : null;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => href && router.push(href)}
                      className={cn("cursor-pointer border-t border-zinc-100 align-top hover:bg-zinc-50", !r.acknowledgedAt && "bg-rose-50/30")}
                      title={r.message}
                    >
                      <td className="px-4 py-2 tabular whitespace-nowrap">{formatKst(r.triggeredAt)}</td>
                      <td className="px-2 py-2 font-medium">{r.code ?? "–"}</td>
                      <td className="px-2 py-2">
                        <div>{r.ruleName}</div>
                        <div className="text-xs text-zinc-500">{r.message.split("\n")[0]}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular font-medium">{observed(r)}</td>
                      <td className="px-2 py-2"><Badge className={SEV_CLS[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge></td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(r.delivery ?? []).length === 0 && <span className="text-xs text-zinc-400">연결된 채널 없음</span>}
                          {(r.delivery ?? []).map((d, i) => (
                            <Badge
                              key={i}
                              title={d.error ?? d.sent_at}
                              className={d.status === "sent" ? "bg-emerald-100 text-emerald-700" : d.status === "held" ? "bg-zinc-200 text-zinc-600" : "bg-rose-100 text-rose-700"}
                            >
                              {d.status === "sent" ? "✓" : d.status === "held" ? "⏸ 보류" : "✗"} {chName.get(d.channel_id) ?? `#${d.channel_id}`}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs whitespace-nowrap">
                        {r.resolvedAt ? <span className="text-emerald-700">복구 {formatKst(r.resolvedAt)}</span> : <span className="text-rose-600">진행 중</span>}
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {r.acknowledgedAt ? (
                          <span className="text-zinc-500">
                            {r.acknowledgedBy} · {formatKst(r.acknowledgedAt, false)}
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => ack([r.id])}>
                            확인
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-zinc-500">
        규칙 유형: {Object.values(RULE_TYPE_LABEL).join(" · ")}. 배치 업로드 운영 중에는 지속 시간 알림이 업로드 시점에 &quot;사후 탐지&quot;됩니다.
      </p>
    </div>
  );
}
