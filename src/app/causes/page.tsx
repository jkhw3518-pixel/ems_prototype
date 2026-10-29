"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/client";
import { cn, durationText, hours, num, pct } from "@/lib/utils";
import type { pareto } from "@/lib/queries/causes";
import type { EventRow } from "@/lib/queries/dashboard";
import { Card, CardHeader, Empty, ErrorBox, Spinner } from "@/components/ui";
import { Kpi } from "@/components/domain";
import { EventTable } from "@/components/event-table";
import { filterQs, RangeBar, useDefaultRange, type RangeFilter } from "@/components/filters";

type Pareto = Awaited<ReturnType<typeof pareto>>;
type Drill = { category?: { key: string; name: string }; cause?: { key: string; name: string } };

export default function CausesPage() {
  const { filter, setFilter } = useDefaultRange(7);
  if (!filter) return <Spinner />;
  return <CausesBody f={filter} setF={setFilter} />;
}

function CausesBody({ f, setF }: { f: RangeFilter; setF: (f: RangeFilter) => void }) {
  const [drill, setDrill] = useState<Drill>({});
  const base = filterQs(f);
  const level = drill.category ? "cause" : "category";
  const par = useApi<Pareto>(`/api/causes/pareto?${filterQs(f, { level, category: drill.category?.key })}`);
  const heat = useApi<{ code: string; category: string; name: string; color: string; minutes: number }[]>(`/api/causes/heatmap?${base}`);
  const inbox = useApi<EventRow[]>(`/api/causes/events?${base}&unclassified=1&limit=150`);
  const drillEvents = useApi<EventRow[]>(
    drill.category ? `/api/causes/events?${filterQs(f, { category: drill.category.key, cause: drill.cause?.key })}` : null,
  );

  const reloadAll = () => {
    par.reload();
    heat.reload();
    inbox.reload();
    drillEvents.reload();
  };

  const k = par.data?.kpi;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-xl font-bold">비가동 원인 분석</h1>
        <RangeBar
          value={f}
          onChange={(v) => {
            setF(v);
            setDrill({});
          }}
        />
      </div>
      {par.error && <ErrorBox error={par.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="분류율 (분류된 시간 / 전체 비가동+정지)"
          value={<span className={cn((k?.rate ?? 0) >= 0.9 ? "text-emerald-600" : (k?.rate ?? 0) >= 0.6 ? "text-amber-600" : "text-rose-600")}>{pct(k?.rate, 0)}</span>}
          sub={
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-100">
              <div className="h-full bg-emerald-500" style={{ width: `${(k?.rate ?? 0) * 100}%` }} />
              <div className="relative -mt-1.5 h-1.5 w-px bg-zinc-800" style={{ left: "90%" }} title="목표 90%" />
            </div>
          }
        />
        <Kpi label="미분류" value={k ? hours(k.unclassifiedMinutes) : "–"} unit="시간" sub={k ? `${k.unclassifiedCount}건 (추천 대기 ${k.suggestedPending}건)` : undefined} />
        <Kpi label="전체 비가동+정지" value={k ? hours(k.totalMinutes) : "–"} unit="시간" sub={k ? `${k.eventCount}개 구간` : undefined} />
        <Kpi label="MTBF (고장)" value={k?.mtbfMin != null ? hours(k.mtbfMin) : "–"} unit={k?.mtbfMin != null ? "시간" : undefined} sub={`고장 ${k?.breakdownCount ?? 0}건 · 정상가동 시간 / 건수`} />
        <Kpi label="MTTR (고장)" value={k?.mttrMin != null ? num(k.mttrMin, 0) : "–"} unit={k?.mttrMin != null ? "분" : undefined} sub="고장 손실 시간 / 건수" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1">
                <button className={cn(drill.category && "text-zinc-500 hover:underline")} onClick={() => setDrill({})}>
                  원인 파레토
                </button>
                {drill.category && (
                  <>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                    <button className={cn(drill.cause && "text-zinc-500 hover:underline")} onClick={() => setDrill({ category: drill.category })}>
                      {drill.category.name}
                    </button>
                  </>
                )}
                {drill.cause && (
                  <>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                    {drill.cause.name}
                  </>
                )}
              </span>
            }
            desc={drill.category ? "세부원인별 손실 시간 · 막대를 누르면 해당 구간만" : "대분류별 손실 시간(분류된 구간) · 막대를 누르면 세부원인으로"}
          />
          {!par.data ? (
            <Spinner />
          ) : par.data.items.length ? (
            <ParetoChart
              items={par.data.items}
              activeKey={drill.cause?.key}
              onPick={(it) =>
                drill.category ? setDrill({ category: drill.category, cause: { key: it.key, name: it.name } }) : setDrill({ category: { key: it.key, name: it.name } })
              }
            />
          ) : (
            <Empty>분류된 비가동 구간이 없습니다. 아래 미분류 작업함에서 원인을 기록하세요.</Empty>
          )}
          {par.data && par.data.items.length > 0 && (
            <table className="w-full border-t border-zinc-100 text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-1.5">{drill.category ? "세부원인" : "대분류"}</th>
                  <th className="px-2 py-1.5 text-right">손실 시간</th>
                  <th className="px-2 py-1.5 text-right">빈도</th>
                  <th className="px-2 py-1.5 text-right">평균</th>
                  <th className="px-2 py-1.5 text-right">손실 수량</th>
                  <th className="px-4 py-1.5 text-right">누적</th>
                </tr>
              </thead>
              <tbody>
                {par.data.items.map((it) => (
                  <tr key={it.key} className="border-t border-zinc-50 hover:bg-zinc-50">
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <i className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
                        {it.name}
                        {it.isPlanned && <span className="text-[10px] text-zinc-400">계획</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">{durationText(it.minutes)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{it.count}</td>
                    <td className="px-2 py-1.5 text-right tabular">{num(it.avgMinutes, 0)}분</td>
                    <td className="px-2 py-1.5 text-right tabular">{it.lostUnits ? num(it.lostUnits) : "–"}</td>
                    <td className="px-4 py-1.5 text-right tabular">{pct(it.cumPct, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="설비 × 원인 히트맵" desc="셀 = 손실 시간 (진할수록 김)" />
          {!heat.data ? <Spinner /> : <Heatmap cells={heat.data} />}
        </Card>
      </div>

      {drill.category && (
        <Card>
          <CardHeader title={`구간 목록 — ${drill.cause?.name ?? drill.category.name}`} desc="가장 긴 순" />
          {!drillEvents.data ? <Spinner /> : <EventTable events={drillEvents.data} onChanged={reloadAll} showEquipment showDate />}
        </Card>
      )}

      <Card>
        <CardHeader
          title={`미분류 구간 작업함 (${inbox.data?.length ?? "…"}${inbox.data?.length === 150 ? "+" : ""})`}
          desc="오래된 순 — 현장 확인 후 원인을 기록하면 분류율과 파레토에 바로 반영됩니다"
        />
        {!inbox.data ? (
          <Spinner />
        ) : (
          <EventTable events={inbox.data} onChanged={reloadAll} showEquipment showDate emptyText="🎉 기간 내 미분류 구간이 없습니다" />
        )}
      </Card>
    </div>
  );
}

function ParetoChart({ items, onPick, activeKey }: { items: Pareto["items"]; onPick: (i: Pareto["items"][number]) => void; activeKey?: string }) {
  const data = items.map((i) => ({ ...i, hours: i.minutes / 60, cum: i.cumPct * 100 }));
  return (
    <div className="px-2 pt-3">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#f1f1f3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={data.length > 6 ? -20 : 0} height={data.length > 6 ? 48 : 30} textAnchor={data.length > 6 ? "end" : "middle"} />
          <YAxis yAxisId="h" tick={{ fontSize: 11 }} unit="h" width={44} />
          <YAxis yAxisId="c" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={40} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(v, n) => (n === "cum" ? [`${Number(v).toFixed(0)}%`, "누적 비율"] : [`${Number(v).toFixed(1)}시간`, "손실 시간"])}
          />
          <Bar yAxisId="h" dataKey="hours" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(_, i) => onPick(items[i])}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} fillOpacity={activeKey && activeKey !== d.key ? 0.35 : 1} />
            ))}
          </Bar>
          <Line yAxisId="c" dataKey="cum" stroke="#18181b" strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Heatmap({ cells }: { cells: { code: string; category: string; name: string; color: string; minutes: number }[] }) {
  const { rows, cols, max, get } = useMemo(() => {
    const rows = [...new Set(cells.map((c) => c.code))];
    const colMap = new Map<string, { key: string; name: string; color: string; total: number }>();
    for (const c of cells) {
      const x = colMap.get(c.category) ?? { key: c.category, name: c.name, color: c.color, total: 0 };
      x.total += c.minutes;
      colMap.set(c.category, x);
    }
    const cols = [...colMap.values()].sort((a, b) => (a.key === "UNCLASSIFIED" ? 1 : b.key === "UNCLASSIFIED" ? -1 : b.total - a.total));
    const m = new Map(cells.map((c) => [`${c.code}:${c.category}`, c.minutes]));
    return { rows, cols, max: Math.max(1, ...cells.map((c) => c.minutes)), get: (r: string, c: string) => m.get(`${r}:${c}`) ?? 0 };
  }, [cells]);
  if (!rows.length) return <Empty>데이터 없음</Empty>;
  return (
    <div className="max-h-[520px] overflow-auto p-3">
      <table className="text-[11px]">
        <thead className="sticky top-0 bg-white">
          <tr>
            <th className="px-1 py-1 text-left">설비</th>
            {cols.map((c) => (
              <th key={c.key} className="px-1 py-1 font-medium" style={{ color: c.key === "UNCLASSIFIED" ? "#71717a" : undefined }}>
                <div className="w-14 truncate" title={c.name}>{c.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="px-1 py-0.5 font-medium whitespace-nowrap">{r}</td>
              {cols.map((c) => {
                const v = get(r, c.key);
                const a = v ? 0.12 + 0.88 * Math.sqrt(v / max) : 0;
                return (
                  <td key={c.key} className="p-0.5">
                    <div
                      className="flex h-6 w-14 items-center justify-center rounded tabular"
                      style={{ background: v ? hexA(c.color, a) : "#fafafa", color: a > 0.6 ? "white" : "#3f3f46" }}
                      title={`${r} · ${c.name}: ${durationText(v)}`}
                    >
                      {v ? hours(v) : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(2)})`;
}
