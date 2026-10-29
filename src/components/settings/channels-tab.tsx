"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Send, Trash2 } from "lucide-react";
import { api, getOperator, useApi } from "@/lib/client";
import { formatKst } from "@/lib/time";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, ErrorBox, Input, Select, Spinner, Toggle } from "../ui";

type Channel = {
  id: number; channelType: string; name: string; target: string; active: boolean; verifiedAt: string | null;
  ruleIds: number[]; failing: boolean;
};
type Rule = { id: number; name: string };

const TYPE_LABEL: Record<string, string> = { email: "이메일", slack: "슬랙", kakao: "카카오 알림톡" };
const PLACEHOLDER: Record<string, string> = {
  email: "manager@saehan.co.kr",
  slack: "https://hooks.slack.com/services/T000/B000/XXXX",
  kakao: "010-1234-5678",
};

export function ChannelsTab() {
  const chs = useApi<Channel[]>("/api/alerts/channels");
  const rules = useApi<Rule[]>("/api/alerts/rules");
  const [form, setForm] = useState({ channelType: "slack", name: "", target: "", ruleIds: [] as number[] });
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testMsg, setTestMsg] = useState<Record<number, string>>({});

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      chs.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const test = async (c: Channel) => {
    setTesting(c.id);
    try {
      const r = await api<{ ok: boolean; error?: string }>(`/api/alerts/channels/${c.id}/test`, { method: "POST" });
      setTestMsg((m) => ({ ...m, [c.id]: r.ok ? "✓ 발송 성공" : `✗ ${r.error}` }));
      chs.reload();
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="수신 채널 등록"
          desc="Slack webhook URL·휴대폰 번호는 암호화되어 저장됩니다. 발송 계정(SMTP/Resend, Solapi 알림톡 키)은 서버 환경변수로 설정합니다."
        />
        <div className="flex flex-wrap items-end gap-2 px-4 py-3">
          <Select value={form.channelType} onChange={(e) => setForm({ ...form, channelType: e.target.value })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input placeholder={form.channelType === "slack" ? "#설비알림" : "생산팀장"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-36" />
          <Input placeholder={PLACEHOLDER[form.channelType]} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="min-w-[260px] flex-1" />
          <Button
            disabled={!form.name || !form.target}
            onClick={() =>
              run(async () => {
                await api("/api/alerts/channels", { method: "POST", json: { ...form, by: getOperator() } });
                setForm({ ...form, name: "", target: "", ruleIds: [] });
              })
            }
          >
            등록
          </Button>
        </div>
        {!!rules.data?.length && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 px-4 py-2 text-xs">
            <span className="text-zinc-500">연결할 규칙:</span>
            {rules.data.map((r) => (
              <Checkbox
                key={r.id}
                label={r.name}
                className="text-xs"
                checked={form.ruleIds.includes(r.id)}
                onChange={(v) => setForm({ ...form, ruleIds: v ? [...form.ruleIds, r.id] : form.ruleIds.filter((x) => x !== r.id) })}
              />
            ))}
          </div>
        )}
        {form.channelType === "kakao" && (
          <p className="border-t border-zinc-100 px-4 py-2 text-xs text-amber-700">
            카카오 알림톡은 카카오 비즈니스 채널 + 사전 승인된 템플릿이 필요합니다 (심사 1~3영업일). 템플릿 변수: #{"{"}설비{"}"}, #{"{"}유형{"}"}, #{"{"}값{"}"}, #{"{"}시각{"}"}, #{"{"}링크{"}"}
          </p>
        )}
      </Card>
      {err && <ErrorBox error={err} />}
      <Card>
        <CardHeader title="등록된 채널" />
        {!chs.data ? (
          <Spinner />
        ) : !chs.data.length ? (
          <Empty>등록된 채널이 없습니다. 알림은 이력에만 기록됩니다.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2">유형</th>
                <th className="px-2 py-2">이름</th>
                <th className="px-2 py-2">대상</th>
                <th className="px-2 py-2">연결 규칙</th>
                <th className="px-2 py-2">검증</th>
                <th className="px-2 py-2">활성</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {chs.data.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 align-top">
                  <td className="px-4 py-2">{TYPE_LABEL[c.channelType]}</td>
                  <td className="px-2 py-2 font-medium">{c.name}</td>
                  <td className="px-2 py-2 font-mono text-xs text-zinc-600">{c.target}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.ruleIds.map((id) => <Badge key={id}>{rules.data?.find((r) => r.id === id)?.name ?? `#${id}`}</Badge>)}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {c.failing && (
                      <div className="mb-1 flex items-center gap-1 text-rose-600"><AlertTriangle className="h-3.5 w-3.5" />최근 3회 연속 발송 실패</div>
                    )}
                    {c.verifiedAt ? (
                      <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{formatKst(c.verifiedAt)}</span>
                    ) : (
                      <span className="text-zinc-400">미검증</span>
                    )}
                    {testMsg[c.id] && <div className={testMsg[c.id].startsWith("✓") ? "text-emerald-700" : "text-rose-600"}>{testMsg[c.id]}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <Toggle checked={c.active} onChange={(v) => run(() => api(`/api/alerts/channels/${c.id}`, { method: "PUT", json: { active: v, by: getOperator() } }))} />
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={testing === c.id} onClick={() => test(c)}>
                      <Send className="h-3.5 w-3.5" />테스트 발송
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(`'${c.name}' 채널을 삭제할까요?`) && run(() => api(`/api/alerts/channels/${c.id}?by=${encodeURIComponent(getOperator())}`, { method: "DELETE" }))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
