"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useApi } from "@/lib/client";
import { addDays, periodOf, type Granularity } from "@/lib/time";
import { hours, pct } from "@/lib/utils";
import { ST_GOOD, ST_WARN } from "@/lib/constants";
import { utilThresholdFor } from "@/lib/alerts/rules";
import type { TrendSeries } from "@/lib/queries/trends";
import type { alertRule, equipment as equipmentT } from "@/db/schema";
import { Button, Card, CardHeader, Checkbox, Empty, ErrorBox, Input, Segmented, Select, Spinner } from "@/components/ui";
import { DeltaArrow } from "@/components/delta-arrow";
import { Sparkline } from "@/components/domain";

type Equip = typeof equipmentT.$inferSelect;
type Rule = typeof alertRule.$inferSelect;
const COLORS = ["#2563eb", "#e5484d", "#12a594", "#f76b15", "#8e4ec6", "#0090ff", "#b45309", "#52525b"];
const MAX_LINES = 8;
const DEFAULT_SPAN: Record<Granularity, (to: string) => string> = {
  day: (to) => addDays(to, -29),
  week: (to) => addDays(periodOf(to, "week").start, -7 * 11),
  month: (to) => {
    const [y, m] = to.split("-").map(Number);
    return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
  },
};
const LABEL = { day: { cur: "당일", prev: "전일", avg: "최근 4일 평균" }, week: { cur: "이번 주", prev: "지난 주", avg: "4주 평균" }, month: { cur: "이번 달", prev: "지난 달", avg: "4개월 평균" } };

export default function TrendsPage() {
  const router = useRouter();
  const meta = useApi<{ dates: string[] }>("/api/meta");
  const eqs = useApi<Equip[]>("/api/equipment");
  const rules = useApi<Rule[]>("/api/alerts/rules");
  const [g, setG] = useState<Granularity>("week");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [factory, setFactory] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState<"equipment" | "factory" | "group">("equipment");
  const [excludePlanned, setExcludePlanned] = useState(false);
  const [sameElapsed, setSameElapsed] = useState(true);
  const [warn, setWarn] = useState<string | null>(null);
  const latest = meta.data?.dates[0];

  useEffect(() => {
    if (latest) setRange({ from: DEFAULT_SPAN[g](latest), to: latest });
  }, [latest, g]);

  // 기본 선택: 가동율 하위 3대
  useEffect(() => {
    if (latest && !codes.length && aggregate === "equipment") pickBottom(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  async function pickBottom(n: number) {
    if (!latest) return;
    const basis = g === "day" ? "dod" : g === "week" ? "wow" : "mom";
    const r = await api<{ items: { equipment: string; factory: string; current: number | null }[] }>(`/api/trends/compare?date=${latest}&basis=${basis}`);
    const list = r.items.filter((i) => i.current != null && (!factory || i.factory === factory)).sort((a, b) => a.current! - b.current!);
    setAggregate("equipment");
    setCodes(list.slice(0, n).map((i) => i.equipment));
  }

  const url = useMemo(() => {
    if (!range) return null;
    if (aggregate === "equipment" && !codes.length) return null;
    const q = new URLSearchParams({ granularity: g, from: range.from, to: range.to, excludePlanned: String(excludePlanned), sameElapsed: String(sameElapsed) });
    if (factory) q.set("factory", factory);
    if (aggregate !== "equipment") q.set("aggregate", aggregate);
    else q.set("equipment", codes.join(","));
    return `/api/trends/utilization?${q}`;
  }, [range, g, factory, codes, aggregate, excludePlanned, sameElapsed]);
  const tr = useApi<{ series: TrendSeries[] }>(url);

  const addCode = (c: string) => {
    if (!c || codes.includes(c)) return;
    if (codes.length >= MAX_LINES) {
      setWarn(`최대 ${MAX_LINES}대까지 선택할 수 있습니다`);
      return;
    }
    setWarn(null);
    setAggregate("equipment");
    setCodes([...codes, c]);
  };

  const series = useMemo(() => tr.data?.series ?? [], [tr.data]);
  const chartData = useMemo(() => {
    const periods = series[0]?.points ?? [];
    return periods.map((p, i) => {
      const row: Record<string, unknown> = { period: p.period, start: p.start };
      for (const s of series) {
        const pt = s.points[i];
        row[s.equipment] = pt?.utilization != null ? Math.round(pt.utilization * 1000) / 10 : null;
        row[`${s.equipment}__pt`] = pt;
      }
      return row;
    });
  }, [series]);

  // 사용자 알림 임계치 기준선 (선택 설비에 UTIL_BELOW 규칙이 있을 때)
  const alertLine = useMemo(() => {
    if (aggregate !== "equipment" || !rules.data || !eqs.data) return null;
    const ths = codes
      .map((c) => eqs.data!.find((e) => e.code === c))
      .filter(Boolean)
      .map((e) => utilThresholdFor(rules.data!, e!, g === "week" ? "week" : "day"))
      .filter((x): x is number => x != null);
    return ths.length ? Math.max(...ths) : null;
  }, [aggregate, rules.data, eqs.data, codes, g]);

  const onPointClick = (code: string, start: string) => {
    if (aggregate !== "equipment") return;
    if (g === "day") router.push(`/equipment/${encodeURIComponent(code)}?date=${start}`);
    else {
      const p = periodOf(start, g);
      router.push(`/causes?from=${p.start}&to=${addDays(p.start, p.days - 1)}&equipment=${encodeURIComponent(code)}`);
    }
  };

  if (meta.error) return <ErrorBox error={meta.error} />;
  if (!range) return <Spinner />;
  const L = LABEL[g];
  const options = (eqs.data ?? []).filter((e) => e.active && (!factory || e.factory === factory) && !codes.includes(e.code));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">가동율 추세</h1>
        <Segmented<Granularity>
          value={g}
          onChange={setG}
          options={[
            { value: "day", label: "일간" },
            { value: "week", label: "주간" },
            { value: "month", label: "월간" },
          ]}
        />
        <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-zinc-400">~</span>
        <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <Select value={factory} onChange={(e) => setFactory(e.target.value)}>
          <option value="">공장 전체</option>
          <option value="1공장">1공장</option>
          <option value="2공장">2공장</option>
        </Select>
      </div>

      <Card className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">설비</span>
          {aggregate === "equipment" ? (
            codes.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm" style={{ borderColor: COLORS[i % 8], color: COLORS[i % 8] }}>
                {c}
                <button onClick={() => setCodes(codes.filter((x) => x !== c))} aria-label={`${c} 제거`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))
          ) : (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-sm text-white">{aggregate === "factory" ? "공장 평균" : "그룹 평균"}</span>
          )}
          <Select value="" onChange={(e) => addCode(e.target.value)} className="h-8 text-sm">
            <option value="">+ 추가</option>
            {options.map((e) => (
              <option key={e.code} value={e.code}>
                {e.code}
              </option>
            ))}
          </Select>
          <span className="mx-1 h-5 w-px bg-zinc-200" />
          <span className="text-xs text-zinc-500">프리셋</span>
          <Button size="sm" variant={aggregate === "factory" ? "default" : "outline"} onClick={() => setAggregate("factory")}>공장 평균</Button>
          <Button size="sm" variant={aggregate === "group" ? "default" : "outline"} onClick={() => setAggregate("group")}>그룹 평균(PET/PE/사출기/S)</Button>
          <Button size="sm" variant="outline" onClick={() => pickBottom(5)}>가동율 하위 5대</Button>
          <div className="ml-auto flex gap-4">
            <Checkbox checked={excludePlanned} onChange={setExcludePlanned} label="계획정지 제외" />
            {g !== "day" && <Checkbox checked={sameElapsed} onChange={setSameElapsed} label="동일 경과일수 비교" />}
          </div>
        </div>
        {warn && <p className="text-xs text-rose-600">{warn}</p>}
      </Card>

      {tr.error && <ErrorBox error={tr.error} />}
      <Card>
        <CardHeader
          title={`${g === "day" ? "일간" : g === "week" ? "주간" : "월간"} 가동율${excludePlanned ? " (계획정지 제외)" : ""}`}
          desc="분 가중 집계(Σ정상가동/Σ대상분) · 미가동 일자는 끊긴 선 · 속이 빈 점선 마커 = 집계 중인 기간 · 점을 누르면 상세로 이동"
        />
        {!url ? (
          <Empty>설비를 선택하거나 프리셋을 고르세요</Empty>
        ) : !tr.data ? (
          <Spinner />
        ) : !series.length ? (
          <Empty>기간 내 데이터가 없습니다</Empty>
        ) : (
          <div className="px-2 pt-3">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ left: 0, right: 24, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#f1f1f3" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickFormatter={(p: string) => (g === "day" ? p.slice(5) : g === "week" ? p.slice(5) : p)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={44} />
                <ReferenceLine y={ST_GOOD * 100} stroke="#22a06b" strokeDasharray="5 4" label={{ value: "양호 95%", position: "insideTopRight", fontSize: 10, fill: "#15803d" }} />
                <ReferenceLine y={ST_WARN * 100} stroke="#f5a524" strokeDasharray="5 4" label={{ value: "주의 80%", position: "insideTopRight", fontSize: 10, fill: "#a16207" }} />
                {alertLine != null && Math.abs(alertLine - ST_WARN) > 0.001 && (
                  <ReferenceLine y={alertLine * 100} stroke="#e5484d" strokeDasharray="3 3" label={{ value: `알림 ${pct(alertLine, 0)}`, position: "insideBottomRight", fontSize: 10, fill: "#b91c1c" }} />
                )}
                <Tooltip content={<TrendTooltip series={series} />} />
                {series.map((s, i) => (
                  <Line
                    key={s.equipment}
                    dataKey={s.equipment}
                    stroke={COLORS[i % 8]}
                    strokeWidth={2}
                    connectNulls={false}
                    isAnimationActive={false}
                    dot={(p: { cx?: number; cy?: number; payload?: Record<string, unknown>; index?: number }) => {
                      const pt = p.payload?.[`${s.equipment}__pt`] as TrendSeries["points"][number] | undefined;
                      if (p.cx == null || p.cy == null || pt?.utilization == null) return <g key={`${s.equipment}-${p.index}`} />;
                      return (
                        <circle
                          key={`${s.equipment}-${p.index}`}
                          cx={p.cx}
                          cy={p.cy}
                          r={pt.inProgress ? 4.5 : 3}
                          fill={pt.inProgress ? "white" : COLORS[i % 8]}
                          stroke={COLORS[i % 8]}
                          strokeWidth={1.5}
                          strokeDasharray={pt.inProgress ? "2 2" : undefined}
                          style={{ cursor: aggregate === "equipment" ? "pointer" : undefined }}
                          onClick={() => onPointClick(s.equipment, pt.start)}
                        />
                      );
                    }}
                    activeDot={{ r: 5, onClick: (_: unknown, e: unknown) => {
                      const pl = (e as { payload?: { start?: string } })?.payload;
                      if (pl?.start) onPointClick(s.equipment, pl.start);
                    } }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {series.length > 0 && (
          <table className="w-full border-t border-zinc-100 text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2">설비</th>
                <th className="px-2 py-2 text-right">{L.cur}</th>
                <th className="px-2 py-2 text-right">{L.prev}</th>
                <th className="px-2 py-2 text-right">증감</th>
                <th className="px-2 py-2 text-right">{L.avg}</th>
                <th className="px-4 py-2">추세</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s, i) => {
                const last = [...s.points].reverse().find((p) => p.utilization != null);
                return (
                  <tr key={s.equipment} className="border-t border-zinc-100">
                    <td className="px-4 py-2 font-medium" style={{ color: COLORS[i % 8] }}>{s.equipment}</td>
                    <td className="px-2 py-2 text-right tabular font-semibold">
                      {pct(s.current)}
                      {last?.inProgress && <span className="ml-1 text-[10px] font-normal text-zinc-400">집계 중 {last.days}일</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular text-zinc-600">{pct(s.previous)}</td>
                    <td className="px-2 py-2 text-right"><DeltaArrow value={s.latestDelta.pp} /></td>
                    <td className="px-2 py-2 text-right tabular text-zinc-600">{pct(s.avg4)}</td>
                    <td className="px-4 py-2"><Sparkline values={s.points.map((p) => p.utilization)} color={COLORS[i % 8]} width={120} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TrendTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; color: string; payload: Record<string, unknown> }[]; label?: string; series: TrendSeries[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      {series.map((s) => {
        const pt = row[`${s.equipment}__pt`] as TrendSeries["points"][number] | undefined;
        const color = payload.find((p) => p.dataKey === s.equipment)?.color;
        if (!pt) return null;
        return (
          <div key={s.equipment} className="mb-1">
            <div className="flex items-center gap-1.5 font-medium" style={{ color }}>
              {s.equipment}: {pt.utilization != null ? pct(pt.utilization) : "미가동/데이터 없음"}
              {pt.inProgress && <span className="text-zinc-400">(집계 중 {pt.days}일)</span>}
            </div>
            {pt.utilization != null && (
              <div className="pl-2 text-zinc-500">
                정상 {hours(pt.runMin)}h · 비가동 {hours(pt.idleMin)}h · 정지 {hours(pt.stopMin)}h
                {pt.topCause && <> · 상위 원인: {pt.topCause.name} {hours(pt.topCause.minutes)}h</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
