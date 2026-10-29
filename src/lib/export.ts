import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { STATE_LABEL } from "./constants";
import { addDays, minuteToClock, type Granularity } from "./time";
import { deltaArrowText, ppDelta, VERDICT_LABEL, verdictOf } from "./utils";
import { rows } from "./queries/common";
import { EVENT_SELECT, type EventRow } from "./queries/dashboard";
import { pareto } from "./queries/causes";
import { utilizationTrend } from "./queries/trends";
import type { ResultJson } from "./engine/analyze";

type SummaryRow = {
  date: string; code: string; factory: string; group: string; target: number; run: number; idle: number; stop: number;
  planned: number; util: number | null; excluded: boolean; lost: number | null; json: ResultJson | null;
};

const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

function sheet(data: Record<string, unknown>[], widths?: number[]) {
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 안내: "데이터 없음" }]);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

/** Excel 보고서 (§8). type=daily 면 from=to 하루, weekly/monthly 면 가동율_추세 시트 포함 */
export async function buildReport(db: DB, opt: { from: string; to: string; type: "daily" | "weekly" | "monthly"; factory?: string | null }) {
  const fcond = opt.factory ? sql`and e.factory = ${opt.factory}` : sql``;
  const summary = await rows<SummaryRow>(
    db,
    sql`select r.analysis_date::text as date, e.code, e.factory, e."group" as group, r.minutes as target, r.run_minutes as run,
          r.idle_minutes as idle, r.stop_minutes as stop, r.planned_stop_minutes as planned, r.utilization_rate::float8 as util,
          r.excluded, r.lost_units::float8 as lost, r.result_json as json
        from ems_analysis_result r join ems_equipment e on e.id = r.equipment_id
        where r.analysis_date between ${addDays(opt.from, -1)} and ${opt.to} ${fcond}
        order by r.analysis_date, e.display_order`,
  );
  const prevMap = new Map(summary.map((s) => [`${s.code}:${s.date}`, s]));
  const inRange = summary.filter((s) => s.date >= opt.from);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      inRange.map((s) => {
        const p = prevMap.get(`${s.code}:${addDays(s.date, -1)}`);
        const pp = !s.excluded && p && !p.excluded ? ppDelta(s.util, p.util) : null;
        const m = s.json?.mold;
        return {
          일자: s.date, 공장: s.factory, 설비: s.code, 그룹: s.group,
          상태: s.excluded ? "미가동(제외)" : VERDICT_LABEL[verdictOf(s.util)],
          "대상(분)": s.target, "정상가동(분)": s.run, "비가동(분)": s.idle, "완전정지(분)": s.stop, "계획정지(분)": s.planned,
          "가동율(%)": s.excluded ? null : r1((s.util ?? 0) * 100),
          "전일대비": deltaArrowText(pp),
          "전일대비(%p)": pp,
          "CAPA(12HR)": s.json?.capa12hr ?? null,
          "못 만든 수량(추정)": s.lost,
          총투입수: m?.inputQty ?? null, 양품수: m?.goodQty ?? null, 이론생산수: m?.theoretical ?? null,
          "속도차질(개)": m?.speedLoss ?? null, "불량(개)": m?.defect ?? null,
          "수율(%)": m?.yield != null ? r1(m.yield * 100) : null,
          "부분 데이터": s.json?.partial ? "Y" : "",
        };
      }),
      [11, 7, 8, 8, 10, 8, 10, 9, 10, 10, 9, 10, 10, 10, 14, 9, 9, 10, 10, 9, 8, 9],
    ),
    "설비별_일요약",
  );

  const events = await rows<EventRow>(
    db,
    sql`${EVENT_SELECT} where ev.analysis_date between ${opt.from} and ${opt.to} ${fcond}
        order by ev.analysis_date, e.display_order, ev.start_minute`,
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      events.map((e) => ({
        일자: e.date, 공장: e.factory, 설비: e.code, 상태: STATE_LABEL[e.state],
        시작: minuteToClock(e.startMinute), 종료: minuteToClock(e.endMinute), "지속(분)": e.duration,
        "평균전류(A)": e.avgCurrent, "최소(A)": e.minCurrent, "최대(A)": e.maxCurrent,
        "손실수량(추정)": e.lostUnits,
        태그: (e.tags ?? []).map((t) => t.t).join(", "),
        원인대분류: e.categoryName ?? "미분류",
        세부원인: e.causeName ?? "",
        추천원인: e.suggestedName ?? "",
        분류방식: e.causeSource === "manual" ? "수기" : e.causeSource === "suggested" ? "추천확정" : e.causeSource === "bulk" ? "일괄" : "",
        입력자: e.classifiedBy ?? "",
        메모: e.memo ?? "",
      })),
      [11, 7, 8, 9, 7, 7, 8, 10, 8, 8, 12, 30, 12, 20, 20, 9, 10, 30],
    ),
    "비가동_구간상세",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      inRange
        .filter((s) => s.json?.nonProd)
        .map((s) => ({
          일자: s.date, 공장: s.factory, 설비: s.code, "가동(분)": s.run,
          "평균전류(A)": s.json!.nonProd!.avgCurrent, "추정 전력량(kWh)": s.json!.nonProd!.kwh,
          비고: "EMS 가동 흔적 있음 / MOLD 생산 실적 없음",
        })),
      [11, 7, 8, 9, 11, 15, 36],
    ),
    "전력추가사용_비생산가동",
  );

  const f = { from: opt.from, to: opt.to, factory: opt.factory };
  const cat = await pareto(db, { ...f, level: "category" });
  const causeLvl = await pareto(db, { ...f, level: "cause" });
  const causeRows: Record<string, unknown>[] = [];
  for (const c of cat.items) {
    causeRows.push({
      구분: "대분류", 대분류: c.name, 세부원인: "", 계획정지: c.isPlanned ? "Y" : "", "손실시간(분)": c.minutes,
      "손실시간(h)": r1(c.minutes / 60), 빈도: c.count, "평균지속(분)": r1(c.avgMinutes), 손실수량: r1(c.lostUnits),
      "비율(%)": r1(c.pct * 100), "누적비율(%)": r1(c.cumPct * 100),
    });
  }
  causeRows.push({});
  const catName = new Map(cat.items.map((c) => [c.key, c.name]));
  const causeCat = await rows<{ code: string; category: string }>(db, sql`select code, category from ems_downtime_cause`);
  const catOf = new Map(causeCat.map((c) => [c.code, c.category]));
  for (const c of causeLvl.items) {
    causeRows.push({
      구분: "세부원인", 대분류: catName.get(catOf.get(c.key) ?? "") ?? "", 세부원인: c.name, 계획정지: c.isPlanned ? "Y" : "",
      "손실시간(분)": c.minutes, "손실시간(h)": r1(c.minutes / 60), 빈도: c.count, "평균지속(분)": r1(c.avgMinutes),
      손실수량: r1(c.lostUnits), "비율(%)": r1(c.pct * 100), "누적비율(%)": r1(c.cumPct * 100),
    });
  }
  causeRows.push({});
  causeRows.push({ 구분: "미분류", "손실시간(분)": cat.kpi.unclassifiedMinutes, 빈도: cat.kpi.unclassifiedCount });
  causeRows.push({ 구분: "분류율(%)", "손실시간(분)": cat.kpi.rate != null ? r1(cat.kpi.rate * 100) : null });
  causeRows.push({ 구분: "MTBF(분)", "손실시간(분)": r1(cat.kpi.mtbfMin) });
  causeRows.push({ 구분: "MTTR(분)", "손실시간(분)": r1(cat.kpi.mttrMin) });
  XLSX.utils.book_append_sheet(wb, sheet(causeRows, [10, 14, 22, 8, 12, 10, 7, 11, 10, 9, 11]), "원인별_집계");

  if (opt.type !== "daily") {
    const g: Granularity = opt.type === "weekly" ? "week" : "month";
    const tr = await utilizationTrend(db, { granularity: g, from: opt.from, to: opt.to, factory: opt.factory });
    const periods = tr.series[0]?.points.map((p) => p.period) ?? [];
    XLSX.utils.book_append_sheet(
      wb,
      sheet(
        tr.series.map((s) => {
          const row: Record<string, unknown> = { 설비: s.equipment };
          for (const p of s.points) row[p.period] = p.utilization != null ? r1(p.utilization * 100) : null;
          row["직전 대비"] = deltaArrowText(s.latestDelta.pp);
          row["증감(%p)"] = s.latestDelta.pp;
          row["최근4기간 평균(%)"] = s.avg4 != null ? r1(s.avg4 * 100) : null;
          return row;
        }),
        [9, ...periods.map(() => 10), 12, 9, 16],
      ),
      "가동율_추세",
    );
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
