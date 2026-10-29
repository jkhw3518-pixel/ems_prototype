import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { addDays, diffDays, eachDate, periodOf, prevPeriodStart, type Granularity } from "../time";
import { deltaDirection, ppDelta } from "../utils";
import { dailyRows, rows, weightedUtil, type DailyRow } from "./common";

export type TrendPoint = {
  period: string;
  start: string;
  utilization: number | null;
  runMin: number;
  idleMin: number;
  stopMin: number;
  plannedMin: number;
  targetMin: number;
  days: number; // 집계된 일수
  totalDays: number; // 기간 전체 일수
  inProgress: boolean;
  topCause: { name: string; minutes: number } | null;
};

export type TrendSeries = {
  equipment: string;
  points: TrendPoint[];
  latestDelta: { pp: number | null; direction: string };
  current: number | null;
  previous: number | null;
  avg4: number | null;
};

type Opts = {
  granularity: Granularity;
  from: string;
  to: string;
  codes?: string[] | null;
  factory?: string | null;
  excludePlanned?: boolean;
  aggregate?: "equipment" | "factory" | "group";
  sameElapsed?: boolean;
  latestDate?: string | null; // 진행 중 기간 판정 기준 (가장 최근 분석일)
};

export async function utilizationTrend(db: DB, o: Opts) {
  const g = o.granularity;
  // 비교를 위해 직전 기간 1개를 더 가져온다
  const fromStart = prevPeriodStart(periodOf(o.from, g).start, g);
  const list = await dailyRows(db, { from: fromStart, to: o.to, factory: o.factory, codes: o.codes });

  // 상위 원인 (툴팁용)
  const causeRows = await rows<{ date: string; code: string; factory: string; group: string; name: string; minutes: number }>(
    db,
    sql`select ev.analysis_date::text as date, e.code, e.factory, e."group" as group, c.category_name as name, sum(ev.duration)::int as minutes
        from ems_downtime_event ev join ems_equipment e on e.id = ev.equipment_id
        join ems_downtime_cause c on c.code = ev.cause_code
        where ev.analysis_date between ${fromStart} and ${o.to}
        group by 1,2,3,4,5`,
  );

  const keyOf = (r: { code: string; factory: string; group: string }) =>
    o.aggregate === "factory" ? `${r.factory} 평균` : o.aggregate === "group" ? `${groupFamily(r.group)} 평균` : r.code;

  const bySeries = new Map<string, DailyRow[]>();
  for (const r of list) {
    const k = keyOf(r);
    bySeries.set(k, [...(bySeries.get(k) ?? []), r]);
  }
  const causesBySeries = new Map<string, typeof causeRows>();
  for (const c of causeRows) {
    const k = keyOf(c);
    causesBySeries.set(k, [...(causesBySeries.get(k) ?? []), c]);
  }

  // 기간 버킷 목록
  const periods: { key: string; start: string; days: number }[] = [];
  const seen = new Set<string>();
  for (const d of eachDate(fromStart, o.to)) {
    const p = periodOf(d, g);
    if (!seen.has(p.key)) {
      seen.add(p.key);
      periods.push(p);
    }
  }
  const latest = o.latestDate ?? o.to;

  const series: TrendSeries[] = [];
  for (const [name, rs] of bySeries) {
    const cs = causesBySeries.get(name) ?? [];
    const points: TrendPoint[] = periods.map((p) => {
      const end = addDays(p.start, p.days - 1);
      const inP = rs.filter((r) => r.date >= p.start && r.date <= end);
      const days = new Set(inP.map((r) => r.date)).size;
      const causeAgg = new Map<string, number>();
      for (const c of cs) if (c.date >= p.start && c.date <= end) causeAgg.set(c.name, (causeAgg.get(c.name) ?? 0) + c.minutes);
      const top = [...causeAgg.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        period: p.key,
        start: p.start,
        utilization: inP.length ? weightedUtil(inP, o.excludePlanned) : null,
        runMin: sum(inP, "run"),
        idleMin: sum(inP, "idle"),
        stopMin: sum(inP, "stop"),
        plannedMin: sum(inP, "planned"),
        targetMin: sum(inP, "target") - (o.excludePlanned ? sum(inP, "planned") : 0),
        days,
        totalDays: p.days,
        inProgress: g !== "day" && end > latest && p.start <= latest,
        topCause: top ? { name: top[0], minutes: top[1] } : null,
      };
    });

    // 비교: 마지막 데이터 기간 vs 직전 기간
    const withData = points.filter((p) => p.utilization != null);
    const last = withData[withData.length - 1];
    let prevUtil: number | null = null;
    if (last) {
      const prevStart = prevPeriodStart(last.start, g);
      if (o.sameElapsed && last.inProgress) {
        // 동일 경과일수 비교 (예: 이번 주 월~수 vs 지난 주 월~수)
        const elapsed = diffDays(latest, last.start) + 1;
        const prevRows = rs.filter((r) => r.date >= prevStart && r.date < addDays(prevStart, elapsed));
        prevUtil = prevRows.length ? weightedUtil(prevRows, o.excludePlanned) : null;
      } else {
        prevUtil = points.find((p) => p.start === prevStart)?.utilization ?? null;
      }
    }
    const pp = last ? ppDelta(last.utilization, prevUtil) : null;
    const visible = points.filter((p) => p.start >= periodOf(o.from, g).start);
    const recent4 = withData.slice(-4);
    const r4 = rs.filter((r) => recent4.some((p) => r.date >= p.start && r.date <= addDays(p.start, p.totalDays - 1)));
    series.push({
      equipment: name,
      points: visible,
      latestDelta: { pp, direction: deltaDirection(pp) },
      current: last?.utilization ?? null,
      previous: prevUtil,
      avg4: r4.length ? weightedUtil(r4, o.excludePlanned) : null,
    });
  }

  return { granularity: g, from: o.from, to: o.to, excludePlanned: !!o.excludePlanned, series };
}

/** 전 설비 현재값/비교값/증감 (§4.5 compare) */
export async function compareAll(db: DB, date: string, basis: "dod" | "wow" | "mom", excludePlanned = false) {
  const g: Granularity = basis === "dod" ? "day" : basis === "wow" ? "week" : "month";
  const cur = periodOf(date, g);
  const prevStart = prevPeriodStart(cur.start, g);
  const elapsed = diffDays(date, cur.start) + 1;
  const list = await dailyRows(db, { from: prevStart, to: date });
  const prevEnd = g === "day" ? prevStart : addDays(prevStart, elapsed - 1); // 동일 경과일수
  const byCode = new Map<string, { factory: string; group: string; cur: DailyRow[]; prev: DailyRow[] }>();
  for (const r of list) {
    let x = byCode.get(r.code);
    if (!x) byCode.set(r.code, (x = { factory: r.factory, group: r.group, cur: [], prev: [] }));
    if (r.date >= cur.start && r.date <= date) x.cur.push(r);
    else if (r.date >= prevStart && r.date <= prevEnd) x.prev.push(r);
  }
  const items = [...byCode.entries()].map(([code, x]) => {
    const c = weightedUtil(x.cur, excludePlanned);
    const p = weightedUtil(x.prev, excludePlanned);
    const pp = ppDelta(c, p);
    return { equipment: code, factory: x.factory, group: x.group, current: c, previous: p, pp, direction: deltaDirection(pp) };
  });
  return { date, basis, period: cur.key, items };
}

function sum(list: DailyRow[], k: "run" | "idle" | "stop" | "planned" | "target") {
  return list.reduce((a, r) => a + r[k], 0);
}

/** 그룹 평균 프리셋: PET / PE / 사출기 / S(블로우) / B */
export function groupFamily(group: string) {
  if (group.startsWith("S-")) return "S";
  if (group.startsWith("B-")) return "B";
  return group;
}
