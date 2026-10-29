"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bell } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/client";
import { minuteToClock } from "@/lib/time";
import { durationText, hours, num, pct } from "@/lib/utils";
import type { EquipmentDetail } from "@/lib/queries/equipment";
import type { EventRow } from "@/lib/queries/dashboard";
import { Card, CardHeader, Empty, ErrorBox, Select, Spinner } from "@/components/ui";
import { DeltaArrow } from "@/components/delta-arrow";
import { Kpi, Sparkline, STATE_COLOR, VerdictBadge } from "@/components/domain";
import { EventTable } from "@/components/event-table";

export default function EquipmentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = decodeURIComponent(rawCode);
  const sp = useSearchParams();
  const router = useRouter();
  const date = sp.get("date");
  const eventId = sp.get("event") ? Number(sp.get("event")) : null;
  const q = useApi<EquipmentDetail>(`/api/equipment/${encodeURIComponent(code)}/detail${date ? `?date=${date}` : ""}`);
  const [hover, setHover] = useState<EventRow | null>(null);

  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const r = d.result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-md p-1 hover:bg-zinc-200">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">{d.equipment.code}</h1>
        <span className="text-sm text-zinc-500">
          {d.equipment.factory} · {d.equipment.group}
          {d.crit && ` · 기준: 정지 ≤${d.crit.stop}A / 비가동 ≤${d.crit.idle}A (${d.crit.duration}분 이상)`}
        </span>
        {d.dates.length > 0 && (
          <Select
            className="ml-auto"
            value={d.date ?? ""}
            onChange={(e) => router.replace(`/equipment/${encodeURIComponent(code)}?date=${e.target.value}`)}
          >
            {d.dates.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        )}
      </div>

      {!r ? (
        <Card><Empty>이 설비의 분석 결과가 없습니다.</Empty></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi
              label="가동율"
              value={r.excluded ? "제외" : pct(r.target ? r.run / r.target : 0)}
              sub={
                r.excluded ? (
                  "22시간 이상 정지 — 미가동 설비"
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <VerdictBadge util={r.run / r.target} />
                    전일 <DeltaArrow value={d.deltas?.day} /> 전주 <DeltaArrow value={d.deltas?.week} />
                    {d.threshold != null && r.run / r.target < d.threshold && (
                      <span className="inline-flex items-center gap-0.5 text-rose-600"><Bell className="h-3 w-3" />임계 {pct(d.threshold, 0)} 미달</span>
                    )}
                  </span>
                )
              }
            />
            <Kpi label="정상가동" value={hours(r.run)} unit="시간" sub={`대상 ${durationText(r.target)}`} />
            <Kpi label="비가동 / 완전정지" value={`${hours(r.idle)} / ${hours(r.stop)}`} unit="시간" sub={r.planned ? `계획정지 분류 ${durationText(r.planned)}` : undefined} />
            <Kpi label="못 만든 수량 (추정)" value={r.lost != null ? num(r.lost) : "–"} unit={r.lost != null ? "개" : undefined} sub={r.json?.capa12hr ? `CAPA(12HR) ${num(r.json.capa12hr)}` : "MOLD 실적 없음"} />
            <Card className="px-4 py-3">
              <div className="text-xs text-zinc-500">최근 30일 가동율</div>
              <Sparkline values={d.spark.map((s) => s.util)} width={190} height={44} className="mt-1" />
              <div className="mt-0.5 flex justify-between text-[10px] text-zinc-400">
                <span>{d.spark[0]?.date.slice(5)}</span>
                <span>{d.spark[d.spark.length - 1]?.date.slice(5)}</span>
              </div>
            </Card>
          </div>

          <CurrentChart d={d} hover={hover} highlightId={eventId} />

          <Card>
            <CardHeader
              title={`비가동 구간 (${d.events.length})`}
              desc="원인을 클릭해 대분류 → 세부원인을 기록하세요. 회색 추천 칩을 누르면 자동 추천 원인으로 확정됩니다. 체크박스로 일괄 분류."
            />
            <EventTable events={d.events} onChanged={q.reload} highlightId={eventId} onHover={setHover} />
          </Card>

          <Card>
            <CardHeader title="생산 실적 (MOLD)" />
            {d.mold.length ? (
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">작업지시</th>
                    <th className="px-2 py-2">품명</th>
                    <th className="px-2 py-2 text-right">CAPA(12HR)</th>
                    <th className="px-2 py-2 text-right">총투입</th>
                    <th className="px-2 py-2 text-right">양품</th>
                    <th className="px-4 py-2 text-right">수율</th>
                  </tr>
                </thead>
                <tbody>
                  {d.mold.map((m) => (
                    <tr key={m.id} className="border-t border-zinc-100">
                      <td className="px-4 py-2">{m.orderNo}</td>
                      <td className="px-2 py-2">{m.itemName}</td>
                      <td className="px-2 py-2 text-right tabular">{num(m.capa12hr)}</td>
                      <td className="px-2 py-2 text-right tabular">{num(m.inputQty)}</td>
                      <td className="px-2 py-2 text-right tabular">{num(m.goodQty)}</td>
                      <td className="px-4 py-2 text-right tabular">{m.inputQty ? pct(m.goodQty / m.inputQty) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
                {r.json?.mold && (
                  <tfoot className="border-t border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
                    <tr>
                      <td colSpan={6} className="px-4 py-2">
                        이론생산 {num(r.json.mold.theoretical)} · 속도 차질 {num(r.json.mold.speedLoss)} · 불량 {num(r.json.mold.defect)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <Empty className="py-6">이 날짜의 MOLD 생산 실적이 없습니다</Empty>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function CurrentChart({ d, hover, highlightId }: { d: EquipmentDetail; hover: EventRow | null; highlightId: number | null }) {
  const data = useMemo(() => d.series.map((p) => ({ m: p.m, v: p.v })), [d.series]);
  const ticks = Array.from({ length: 13 }, (_, i) => i * 120);
  const focus = hover ?? d.events.find((e) => e.id === highlightId) ?? null;
  const yMax = Math.max(d.crit?.idle ?? 50, ...d.series.map((s) => s.v ?? 0)) * 1.1;

  return (
    <Card>
      <CardHeader title="전류 추이 (1분)" desc="음영: 비가동/정지 구간 (원인 분류 시 원인 색상) · 점선: 판정 임계값" />
      <div className="px-2 pt-3">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
            <CartesianGrid stroke="#f1f1f3" vertical={false} />
            <XAxis dataKey="m" type="number" domain={[0, 1440]} ticks={ticks} tickFormatter={minuteToClock} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, Math.ceil(yMax)]} tick={{ fontSize: 11 }} unit="A" width={48} />
            {d.events.map((e) => (
              <ReferenceArea
                key={e.id}
                x1={e.startMinute}
                x2={e.endMinute}
                fill={e.causeColor ?? (e.state === "stop" ? STATE_COLOR.stop : STATE_COLOR.idle)}
                fillOpacity={focus?.id === e.id ? 0.4 : 0.14}
                stroke={focus?.id === e.id ? "#18181b" : undefined}
                ifOverflow="hidden"
              />
            ))}
            {d.crit && <ReferenceLine y={d.crit.idle} stroke="#f5a524" strokeDasharray="4 3" label={{ value: `비가동 ${d.crit.idle}A`, fontSize: 10, position: "insideTopRight", fill: "#a16207" }} />}
            {d.crit && <ReferenceLine y={d.crit.stop} stroke="#e5484d" strokeDasharray="4 3" label={{ value: `정지 ${d.crit.stop}A`, fontSize: 10, position: "insideBottomRight", fill: "#b91c1c" }} />}
            <Tooltip
              labelFormatter={(m) => minuteToClock(Number(m))}
              formatter={(v) => [v == null ? "결측" : `${v} A`, "전류"]}
              contentStyle={{ fontSize: 12 }}
            />
            <Line dataKey="v" stroke="#27272a" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Timeline d={d} focusId={focus?.id ?? null} />
    </Card>
  );
}

/** 상태 타임라인 — 정상가동 바탕 위에 비가동/정지 블록, 분류된 구간은 원인 색 테두리 */
function Timeline({ d, focusId }: { d: EquipmentDetail; focusId: number | null }) {
  const target = d.result?.target ?? 1440;
  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>상태 타임라인</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: STATE_COLOR.run }} />정상가동</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: STATE_COLOR.idle }} />비가동</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: STATE_COLOR.stop }} />완전정지</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm border-2 border-violet-500" />원인 분류됨(원인 색)</span>
        </span>
      </div>
      <div className="relative ml-12 mr-4 h-7 overflow-hidden rounded bg-zinc-100">
        <div className="absolute inset-y-0 left-0" style={{ width: `${(target / 1440) * 100}%`, background: STATE_COLOR.run, opacity: 0.85 }} />
        {d.events.map((e) => (
          <div
            key={e.id}
            title={`${minuteToClock(e.startMinute)}~${minuteToClock(e.endMinute)} ${e.duration}분${e.causeName ? ` · ${e.categoryName} > ${e.causeName}` : " · 미분류"}`}
            className="absolute inset-y-0"
            style={{
              left: `${(e.startMinute / 1440) * 100}%`,
              width: `${Math.max(0.15, (e.duration / 1440) * 100)}%`,
              background: e.state === "stop" ? STATE_COLOR.stop : STATE_COLOR.idle,
              boxShadow: e.causeColor ? `inset 0 -6px 0 ${e.causeColor}` : undefined,
              outline: focusId === e.id ? "2px solid #18181b" : undefined,
              zIndex: focusId === e.id ? 2 : 1,
            }}
          />
        ))}
      </div>
      <div className="relative ml-12 mr-4 mt-1 h-3 text-[10px] text-zinc-400">
        {Array.from({ length: 7 }, (_, i) => i * 240).map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${(m / 1440) * 100}%` }}>
            {minuteToClock(m)}
          </span>
        ))}
      </div>
    </div>
  );
}
