"use client";

import { useState } from "react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { api, getOperator, useApi } from "@/lib/client";
import { RULE_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/constants";
import { pct } from "@/lib/utils";
import type { alertRule, criteria, equipment } from "@/db/schema";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, ErrorBox, Input, Select, Spinner, Toggle } from "../ui";

type Rule = typeof alertRule.$inferSelect & { channelIds: number[] };
type Channel = { id: number; channelType: string; name: string; active: boolean };
type Equip = typeof equipment.$inferSelect;
type Crit = typeof criteria.$inferSelect;

type Form = {
  id?: number;
  name: string;
  ruleType: string;
  scopeType: string;
  scopeValues: string[];
  threshold: number;
  period: string;
  severity: string;
  cooldownMin: number;
  quietStart: string;
  quietEnd: string;
  excludePlanned: boolean;
  active: boolean;
  channelIds: number[];
};

const EMPTY: Form = {
  name: "", ruleType: "UTIL_BELOW", scopeType: "all", scopeValues: [], threshold: 0.8, period: "day", severity: "warning",
  cooldownMin: 60, quietStart: "", quietEnd: "", excludePlanned: true, active: true, channelIds: [],
};

function thresholdText(r: { ruleType: string; threshold: number | string }) {
  const t = Number(r.threshold);
  if (r.ruleType === "UTIL_BELOW") return `< ${pct(t, 0)}`;
  if (r.ruleType === "UTIL_DROP") return `▼ ${t}%p 이상`;
  return `≥ ${t}분`;
}
function scopeText(r: { scopeType: string; scopeValue: string | null }) {
  return r.scopeType === "all" ? "전체" : `${{ factory: "공장", group: "그룹", equipment: "설비" }[r.scopeType]}: ${r.scopeValue}`;
}
const PERIOD_LABEL: Record<string, string> = { day: "일", week: "주", rolling_2h: "최근 2시간(실시간)" };

export function RulesTab() {
  const rules = useApi<Rule[]>("/api/alerts/rules");
  const chs = useApi<Channel[]>("/api/alerts/channels");
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      rules.reload();
      chs.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const toggle = (r: Rule, active: boolean) => run(() => api(`/api/alerts/rules/${r.id}`, { method: "PUT", json: { active, by: getOperator() } }));
  const del = (r: Rule) => confirm(`'${r.name}' 규칙을 삭제할까요? 관련 알림 이력도 함께 삭제됩니다.`) && run(() => api(`/api/alerts/rules/${r.id}?by=${encodeURIComponent(getOperator())}`, { method: "DELETE" }));

  if (!rules.data) return <Spinner />;
  const chName = new Map((chs.data ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      {err && <ErrorBox error={err} />}
      {form && (
        <RuleForm
          initial={form}
          channels={chs.data ?? []}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            rules.reload();
          }}
        />
      )}
      <Card>
        <CardHeader
          title="알림 규칙"
          desc="범위가 겹치면 가장 구체적인 규칙(설비 > 그룹 > 공장 > 전체)만 적용됩니다. 동일 설비·동일 사유는 하루 최대 10건."
          right={!form && <Button onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4" />규칙 추가</Button>}
        />
        {!rules.data.length ? (
          <Empty>규칙이 없습니다</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2">이름</th>
                <th className="px-2 py-2">유형</th>
                <th className="px-2 py-2">범위</th>
                <th className="px-2 py-2">임계치</th>
                <th className="px-2 py-2">심각도</th>
                <th className="px-2 py-2">채널</th>
                <th className="px-2 py-2">활성</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2">
                    {RULE_TYPE_LABEL[r.ruleType]}
                    {r.period && <span className="text-xs text-zinc-500"> / {PERIOD_LABEL[r.period] ?? r.period}</span>}
                  </td>
                  <td className="px-2 py-2 text-zinc-600">{scopeText(r)}</td>
                  <td className="px-2 py-2 tabular">{thresholdText(r)}</td>
                  <td className="px-2 py-2">
                    <Badge className={r.severity === "critical" ? "bg-rose-600 text-white" : r.severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-700"}>
                      {SEVERITY_LABEL[r.severity]}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.channelIds.length ? (
                        r.channelIds.map((id) => <Badge key={id}>{chName.get(id)?.name ?? `#${id}`}</Badge>)
                      ) : (
                        <span className="text-xs text-amber-700">채널 미지정 (이력만 기록)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2"><Toggle checked={r.active} onChange={(v) => toggle(r, v)} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          id: r.id, name: r.name, ruleType: r.ruleType, scopeType: r.scopeType,
                          scopeValues: (r.scopeValue ?? "").split(",").filter(Boolean), threshold: Number(r.threshold),
                          period: r.period ?? "day", severity: r.severity, cooldownMin: r.cooldownMin,
                          quietStart: r.quietStart?.slice(0, 5) ?? "", quietEnd: r.quietEnd?.slice(0, 5) ?? "",
                          excludePlanned: r.excludePlanned, active: r.active, channelIds: r.channelIds,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(r)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
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

function RuleForm({ initial, channels, onCancel, onSaved }: { initial: Form; channels: Channel[]; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; samples: string[]; from: string | null; to: string | null; byEquipment?: [string, number][] } | null>(null);
  const eqs = useApi<Equip[]>("/api/equipment");
  const crit = useApi<Crit[]>("/api/criteria");
  const isUtil = f.ruleType === "UTIL_BELOW";
  const isDrop = f.ruleType === "UTIL_DROP";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setPreview(null);
  };

  const payload = () => ({
    name: f.name, ruleType: f.ruleType, scopeType: f.scopeType, scopeValue: f.scopeValues.join(","), threshold: f.threshold,
    period: f.ruleType.startsWith("UTIL") ? f.period : null, severity: f.severity, cooldownMin: f.cooldownMin,
    quietStart: f.quietStart || null, quietEnd: f.quietEnd || null, excludePlanned: f.excludePlanned, active: f.active,
    channelIds: f.channelIds, by: getOperator(),
  });

  const save = async () => {
    setErr(null);
    try {
      if (f.id) await api(`/api/alerts/rules/${f.id}`, { method: "PUT", json: payload() });
      else await api("/api/alerts/rules", { method: "POST", json: payload() });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const runPreview = async () => {
    setErr(null);
    try {
      setPreview(await api("/api/alerts/rules/preview", { method: "POST", json: { ...payload(), id: f.id } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const scopeOptions =
    f.scopeType === "factory" ? ["1공장", "2공장"] : f.scopeType === "group" ? (crit.data ?? []).map((c) => c.group) : f.scopeType === "equipment" ? (eqs.data ?? []).map((e) => e.code) : [];

  const changeType = (t: string) => {
    setF((s) => ({
      ...s,
      ruleType: t,
      threshold: t === "UTIL_BELOW" ? 0.8 : t === "UTIL_DROP" ? 10 : t === "STOP_DURATION" ? 60 : 30,
      period: t === "UTIL_DROP" && s.period === "rolling_2h" ? "day" : s.period,
    }));
    setPreview(null);
  };

  return (
    <Card className="border-zinc-900">
      <CardHeader title={f.id ? "규칙 편집" : "새 알림 규칙"} />
      <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
        <Field label="이름">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} className="w-full" placeholder="예: PET 라인 장시간 정지" />
        </Field>
        <Field label="유형">
          <Select value={f.ruleType} onChange={(e) => changeType(e.target.value)} className="w-full">
            {Object.entries(RULE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
          </Select>
        </Field>
        <Field label={isUtil ? `임계치: 가동율 ${pct(f.threshold, 0)} 미만` : isDrop ? "임계치: 하락폭 (%p)" : "임계치: 연속 지속 시간 (분)"}>
          {isUtil ? (
            <div className="flex items-center gap-3">
              <input type="range" min={30} max={99} value={Math.round(f.threshold * 100)} onChange={(e) => set("threshold", Number(e.target.value) / 100)} className="flex-1 accent-zinc-900" />
              <Input type="number" min={1} max={99} className="w-20" value={Math.round(f.threshold * 100)} onChange={(e) => set("threshold", Number(e.target.value) / 100)} />
              <span className="text-sm">%</span>
            </div>
          ) : (
            <Input type="number" min={1} className="w-32" value={f.threshold} onChange={(e) => set("threshold", Number(e.target.value))} />
          )}
        </Field>
        {(isUtil || isDrop) && (
          <Field label="평가 기간">
            <Select value={f.period} onChange={(e) => set("period", e.target.value)}>
              <option value="day">일 (분석 완료 시)</option>
              <option value="week">주 (월요일 07:30)</option>
              {isUtil && <option value="rolling_2h">최근 2시간 (실시간 수집 시)</option>}
            </Select>
          </Field>
        )}
        <Field label="적용 범위">
          <div className="space-y-2">
            <Select value={f.scopeType} onChange={(e) => setF({ ...f, scopeType: e.target.value, scopeValues: [] })}>
              <option value="all">전체</option>
              <option value="factory">공장</option>
              <option value="group">설비 그룹</option>
              <option value="equipment">개별 설비</option>
            </Select>
            {f.scopeType !== "all" && (
              <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto rounded border border-zinc-200 p-2">
                {scopeOptions.map((o) => (
                  <Checkbox
                    key={o}
                    label={o}
                    checked={f.scopeValues.includes(o)}
                    onChange={(v) => set("scopeValues", v ? [...f.scopeValues, o] : f.scopeValues.filter((x) => x !== o))}
                  />
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="심각도">
          <Select value={f.severity} onChange={(e) => set("severity", e.target.value)}>
            <option value="info">정보</option>
            <option value="warning">경고</option>
            <option value="critical">위험 (방해금지 무시)</option>
          </Select>
        </Field>
        <Field label="수신 채널">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {channels.length ? (
              channels.map((c) => (
                <Checkbox
                  key={c.id}
                  label={`${c.name} (${c.channelType})`}
                  checked={f.channelIds.includes(c.id)}
                  onChange={(v) => set("channelIds", v ? [...f.channelIds, c.id] : f.channelIds.filter((x) => x !== c.id))}
                />
              ))
            ) : (
              <span className="text-xs text-zinc-500">등록된 채널이 없습니다 — 수신 채널 탭에서 먼저 등록하세요</span>
            )}
          </div>
        </Field>
        <Field label="재알림 간격 (쿨다운, 분)">
          <Input type="number" min={0} className="w-28" value={f.cooldownMin} onChange={(e) => set("cooldownMin", Number(e.target.value))} />
        </Field>
        <Field label="방해금지 시간 (위험 등급은 무시, 해제 시 묶음 발송)">
          <div className="flex items-center gap-2">
            <Input type="time" value={f.quietStart} onChange={(e) => set("quietStart", e.target.value)} />
            <span>~</span>
            <Input type="time" value={f.quietEnd} onChange={(e) => set("quietEnd", e.target.value)} />
          </div>
        </Field>
        <Field label="옵션">
          <div className="flex flex-col gap-1">
            <Checkbox checked={f.excludePlanned} onChange={(v) => set("excludePlanned", v)} label="계획정지로 분류 확정된 구간/시간 제외" />
            <Checkbox checked={f.active} onChange={(v) => set("active", v)} label="활성" />
          </div>
        </Field>
      </div>
      {err && <div className="px-4 pb-3"><ErrorBox error={err} /></div>}
      {preview && (
        <div className="mx-4 mb-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
          <b>
            최근 7일({preview.from} ~ {preview.to}) 데이터에 이 규칙을 적용했다면 {preview.count}건 발생
          </b>
          {preview.count > 30 && <span className="ml-2 text-rose-600">— 알림이 과다할 수 있습니다. 임계치나 범위를 조정해 보세요.</span>}
          {!!preview.byEquipment?.length && (
            <div className="mt-1 text-xs text-zinc-600">설비별: {preview.byEquipment.map(([c, n]) => `${c} ${n}건`).join(", ")}</div>
          )}
          <ul className="mt-1 list-disc pl-5 text-xs text-zinc-600">
            {preview.samples.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
        <Button onClick={save}>저장</Button>
        <Button variant="outline" onClick={runPreview}><Eye className="h-4 w-4" />미리보기</Button>
        <Button variant="ghost" onClick={onCancel}>취소</Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <div>{children}</div>
    </label>
  );
}
