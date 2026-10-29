"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Download, Play, RefreshCw } from "lucide-react";
import { api, emitChange, useApi } from "@/lib/client";
import { minuteToClock } from "@/lib/time";
import { cn, hours, num, pct } from "@/lib/utils";
import type { Dashboard } from "@/lib/queries/dashboard";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Segmented, Select, Spinner } from "@/components/ui";
import { DeltaArrow } from "@/components/delta-arrow";
import { CauseBadge, Kpi, StackBar, StateBadge, Tags, VerdictBadge } from "@/components/domain";

type Factory = "" | "1공장" | "2공장";

export default function DashboardPage() {
  const meta = useApi<{ dates: string[] }>("/api/meta");
  const [date, setDate] = useState<string>("");
  const [factory, setFactory] = useState<Factory>("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (date || !meta.data?.dates.length) return;
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(fromUrl && meta.data.dates.includes(fromUrl) ? fromUrl : meta.data.dates[0]);
  }, [meta.data, date]);

  const dash = useApi<Dashboard>(date ? `/api/dashboard/${date}${factory ? `?factory=${encodeURIComponent(factory)}` : ""}` : null);

  const analyze = async () => {
    if (!date) return;
    setRunning(true);
    setMsg(null);
    try {
      const r = await api<{ results: { date: string; running: number; excluded: number; events: number; alerts?: { created: number } }[] }>("/api/analyze", {
        method: "POST",
        json: { date },
      });
      const x = r.results[0];
      setMsg(`${x.date} 재분석 완료 — 가동 ${x.running}대 · 미가동 제외 ${x.excluded}대 · 구간 ${x.events}개${x.alerts?.created ? ` · 신규 알림 ${x.alerts.created}건` : ""}`);
      dash.reload();
      emitChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (meta.loading && !meta.data) return <Spinner />;
  if (meta.error) return <ErrorBox error={meta.error} />;
  if (!meta.data?.dates.length)
    return (
      <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">분석된 데이터가 없습니다</h1>
        <p className="mt-2 text-sm text-zinc-500">EMS 전류 JSON 파일을 업로드하면 자동으로 분석됩니다.</p>
        <Link href="/upload" className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm text-white">
          데이터 업로드
        </Link>
      </Card>
    );

  const d = dash.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">한눈에 보기</h1>
        <Select value={date} onChange={(e) => setDate(e.target.value)}>
          {meta.data.dates.map((x) => (
            <option key={x} value={x}>
              {x} (07:00~익일 07:00)
            </option>
          ))}
        </Select>
        <Segmented<Factory>
          value={factory}
          onChange={setFactory}
          options={[
            { value: "", label: "전체" },
            { value: "1공장", label: "1공장" },
            { value: "2공장", label: "2공장" },
          ]}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={analyze} disabled={running}>
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 분석 실행
          </Button>
          <a href={`/api/export/${date}${factory ? `?factory=${encodeURIComponent(factory)}` : ""}`}>
            <Button variant="outline">
              <Download className="h-4 w-4" /> 엑셀 보고서
            </Button>
          </a>
        </div>
      </div>
      {msg && <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700">{msg}</div>}
      {dash.error && <ErrorBox error={dash.error} />}
      {!d ? (
        <Spinner />
      ) : (
        <DashboardBody d={d} />
      )}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const s = d.summary;
  const prev = s.prev;
  const worst = d.equipment[0];
  const sentence = s.running
    ? `가동 설비 ${s.running}대의 평균 가동율은 ${pct(s.util)}입니다. 비가동·정지 ${hours(s.downMin)}시간, 점검 필요 ${s.needCheck}대${
        worst ? ` — 가장 낮은 설비는 ${worst.code} (${pct(worst.util)})` : ""
      }.`
    : "가동한 설비가 없습니다.";

  return (
    <>
      {d.partial && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          이 날짜는 데이터가 하루(1,440분)를 다 채우지 않았습니다. 가동율은 데이터가 있는 구간 기준으로 계산되었습니다.
        </div>
      )}

      <Card className="flex flex-wrap items-center gap-6 px-6 py-5">
        <div>
          <div className="text-xs text-zinc-500">평균 가동율 (분 가중)</div>
          <div className="flex items-center gap-3">
            <span className="text-5xl font-extrabold tabular tracking-tight">{pct(s.util)}</span>
            <VerdictBadge util={s.util} className="px-3 py-1 text-sm" />
          </div>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-xs text-zinc-500">전일 대비</div>
            <DeltaArrow value={s.utilDeltaDay} className="text-base" />
          </div>
          <div>
            <div className="text-xs text-zinc-500">전주 동요일 대비</div>
            <DeltaArrow value={s.utilDeltaWeek} className="text-base" />
          </div>
        </div>
        <p className="min-w-[280px] flex-1 text-sm leading-relaxed text-zinc-700">{sentence}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="비가동 + 완전정지"
          value={hours(s.downMin)}
          unit="시간"
          sub={
            <span className="flex items-center gap-2">
              비가동 {hours(s.idleMin)}h · 정지 {hours(s.stopMin)}h
              <DeltaArrow value={prev ? (s.downMin - prev.downMin) / 60 : null} inverse unit="h" label="전일 대비" />
            </span>
          }
        />
        <Kpi
          label="못 만든 수량 (추정)"
          value={s.lostUnits != null ? num(s.lostUnits) : "–"}
          unit={s.lostUnits != null ? "개" : undefined}
          sub={
            s.lostUnits != null ? (
              <span className="flex items-center gap-2">
                (비가동+정지분) × CAPA/720
                <DeltaArrow value={prev?.lostUnits != null ? s.lostUnits - prev.lostUnits : null} inverse unit="개" digits={0} flat={0} />
              </span>
            ) : (
              <Link href="/upload" className="underline">MOLD 실적 업로드 시 계산</Link>
            )
          }
        />
        <Kpi
          label="점검 필요 설비 (가동율 80% 미만)"
          value={s.needCheck}
          unit="대"
          sub={
            <span className="flex items-center gap-2">
              가동 {s.running}대 · 미가동 제외 {s.excludedCount}대
              <DeltaArrow value={prev ? s.needCheck - prev.needCheck : null} inverse unit="대" digits={0} flat={0} />
            </span>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="설비별 가동 구성"
            desc="가동율 낮은 순 · 숫자 옆 화살표는 전일 대비"
            right={
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <Legend color="var(--run)" label="정상가동" />
                <Legend color="var(--idle)" label="비가동" />
                <Legend color="var(--stop)" label="완전정지" />
              </div>
            }
          />
          {d.equipment.length ? (
            <div className="grid gap-x-6 gap-y-1 p-3 md:grid-cols-2">
              {d.equipment.map((e) => (
                <Link
                  key={e.code}
                  href={`/equipment/${encodeURIComponent(e.code)}?date=${d.date}`}
                  className={cn(
                    "grid grid-cols-[64px_1fr_auto] items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-zinc-50",
                    e.belowAlert ? "border-rose-300 bg-rose-50/40" : "border-transparent",
                  )}
                  title={e.belowAlert ? `알림 임계치 ${pct(e.alertThreshold, 0)} 미달` : undefined}
                >
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {e.belowAlert && <Bell className="h-3.5 w-3.5 text-rose-500" />}
                    {e.code}
                  </span>
                  <StackBar run={e.run} idle={e.idle} stop={e.stop} />
                  <span className="flex w-[104px] items-center justify-end gap-1.5">
                    <span className={cn("text-sm font-semibold tabular", e.util < 0.8 ? "text-rose-600" : e.util < 0.95 ? "text-amber-700" : "text-zinc-800")}>
                      {pct(e.util)}
                    </span>
                    <DeltaArrow value={e.deltaPP} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>가동한 설비가 없습니다</Empty>
          )}
          {s.excluded.length > 0 && (
            <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
              미가동 제외 ({s.excluded.length}대, 22시간 이상 정지): {s.excluded.join(", ")}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="먼저 확인할 구간 TOP 5" desc="가장 길게 멈춘 순" />
            {d.top5.length ? (
              <ul className="divide-y divide-zinc-100">
                {d.top5.map((e, i) => (
                  <li key={e.id}>
                    <Link href={`/equipment/${encodeURIComponent(e.code)}?date=${d.date}&event=${e.id}`} className="flex gap-3 px-4 py-2.5 hover:bg-zinc-50">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold">{e.code}</span>
                          <StateBadge state={e.state} />
                          <span className="tabular text-zinc-600">
                            {minuteToClock(e.startMinute)}~{minuteToClock(e.endMinute)}
                          </span>
                          <span className="ml-auto font-semibold tabular">{e.duration}분</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <CauseBadge name={e.causeName} category={e.categoryName} color={e.causeColor} />
                          {!e.causeCode && e.suggestedName && <Badge className="bg-zinc-100 text-zinc-500">추천: {e.suggestedName}</Badge>}
                          <Tags tags={e.tags} />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>비가동 구간 없음</Empty>
            )}
          </Card>

          <Card>
            <CardHeader
              title="원인 분류 현황"
              right={
                <Link href="/causes" className="text-xs text-zinc-500 underline">
                  원인 분석 →
                </Link>
              }
            />
            <div className="flex items-center gap-5 px-4 py-3">
              <div>
                <div className="text-xs text-zinc-500">분류율</div>
                <div className={cn("text-3xl font-bold tabular", (d.classification.rate ?? 0) >= 0.9 ? "text-emerald-600" : "text-zinc-900")}>
                  {pct(d.classification.rate, 0)}
                </div>
                <div className="text-[11px] text-zinc-400">목표 90% 이상</div>
              </div>
              <div className="flex-1 space-y-1.5">
                {d.classification.top.length ? (
                  d.classification.top.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                      <span className="flex-1">{c.name}</span>
                      <span className="tabular text-zinc-600">{hours(c.minutes)}h</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500">
                    아직 분류된 구간이 없습니다. <Link href="/causes" className="underline">미분류 작업함</Link>에서 기록하세요.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {d.hasMold && (
            <Card>
              <CardHeader title="전력 추가 사용분" desc="EMS 가동 흔적은 있으나 MOLD 생산 실적이 없는 설비" />
              {d.nonProd.length ? (
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                    <tr>
                      <th className="px-4 py-1.5">설비</th>
                      <th className="px-2 py-1.5 text-right">가동</th>
                      <th className="px-2 py-1.5 text-right">평균 전류</th>
                      <th className="px-4 py-1.5 text-right">추정 전력량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.nonProd.map((n) => (
                      <tr key={n.code} className="border-t border-zinc-100">
                        <td className="px-4 py-1.5 font-medium">{n.code}</td>
                        <td className="px-2 py-1.5 text-right tabular">{hours(n.runMinutes)}h</td>
                        <td className="px-2 py-1.5 text-right tabular">{num(n.avgCurrent, 1)}A</td>
                        <td className="px-4 py-1.5 text-right tabular font-medium">{num(n.kwh, 1)} kWh</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty className="py-4">해당 설비 없음</Empty>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
