// 분석 엔진 순수 로직 (§6.1 ~ §6.5). DB 의존성 없음.
import {
  CHG_MAX, CHG_MIN, DAY_MINUTES, LONG_MIN, MIN_RUN_FOR_DAY, NOPROD_STOP_MIN, SHIFT_CHANGES_MIN, SHIFT_WINDOW_MIN, SHORT_MIN,
} from "../constants";
import type { Tag } from "@/db/schema";

export type State = "run" | "idle" | "stop";
export type Crit = { stop: number; idle: number; duration: number };

export type Segment = {
  state: Exclude<State, "run">;
  start: number; // 경과분 (포함)
  end: number; // 경과분 (미포함)
  duration: number;
  avg: number;
  min: number;
  max: number;
  tags: Tag[];
  suggested?: string | null;
};

export type ClassifyResult = {
  values: number[]; // 결측 보정된 1분 전류
  states: State[];
  target: number; // 분석 대상 분 (데이터가 끝난 뒤의 꼬리는 제외)
  missing: number;
  partial: boolean;
  run: number;
  idle: number;
  stop: number;
  wholeDayStop: boolean;
  longestStop: number;
  excluded: boolean;
};

/** raw[i] = i번째 분의 전류 (없으면 null) */
export function classify(raw: (number | null)[], crit: Crit): ClassifyResult {
  let last = -1;
  for (let i = raw.length - 1; i >= 0; i--) if (raw[i] != null) { last = i; break; }
  const target = last < 0 ? 0 : last + 1;
  const partial = target < DAY_MINUTES;

  // 결측: 2분 이내 공백은 직전 값으로 보정, 그 이상은 0A(정지)로 간주
  const values: number[] = new Array(target).fill(0);
  let missing = 0;
  let prev: number | null = null;
  let gap = 0;
  for (let i = 0; i < target; i++) {
    const v = raw[i];
    if (v == null) {
      missing++;
      gap++;
      values[i] = prev != null && gap <= 2 ? prev : 0;
    } else {
      gap = 0;
      prev = v;
      values[i] = v;
    }
  }

  const states: State[] = values.map((v) => (v <= crit.stop ? "stop" : v <= crit.idle ? "idle" : "run"));
  // 비가동 후보 구간이 지속 조건 미만이면 정상가동으로
  for (let i = 0; i < target; ) {
    if (states[i] !== "idle") { i++; continue; }
    let j = i;
    while (j < target && states[j] === "idle") j++;
    if (j - i < crit.duration) for (let k = i; k < j; k++) states[k] = "run";
    i = j;
  }

  let run = states.filter((s) => s === "run").length;
  const wholeDayStop = run <= MIN_RUN_FOR_DAY;
  if (wholeDayStop) {
    states.fill("stop");
    run = 0;
  }
  const idle = states.filter((s) => s === "idle").length;
  const stop = target - run - idle;

  let longestStop = 0;
  for (let i = 0; i < target; ) {
    if (states[i] !== "stop") { i++; continue; }
    let j = i;
    while (j < target && states[j] === "stop") j++;
    longestStop = Math.max(longestStop, j - i);
    i = j;
  }
  // 22시간 이상 정지 → 미가동 설비로 제외. 연속 정지뿐 아니라 짧은 깜빡임으로 끊긴 정지의 합계도 본다
  // (2026-10-13 실데이터 PET-7: 가동 12분/정지 1404분 → 제외, 프로토타입 검증치 21대 가동·11대 제외와 일치)
  // 데이터가 짧은 날은 대상분 대비로 판정
  const limit = Math.min(NOPROD_STOP_MIN, target);
  const excluded = target > 0 && (wholeDayStop || longestStop >= limit || stop >= limit);

  return { values, states, target, missing, partial, run, idle, stop, wholeDayStop, longestStop, excluded };
}

/** 연속 동일 상태 구간 탐지 + 태그 부여 (§6.2) */
export function detectSegments(c: ClassifyResult): Segment[] {
  const segs: Segment[] = [];
  const { states, values, target } = c;
  for (let i = 0; i < target; ) {
    const s = states[i];
    let j = i;
    while (j < target && states[j] === s) j++;
    if (s !== "run") {
      const slice = values.slice(i, j);
      segs.push({
        state: s,
        start: i,
        end: j,
        duration: j - i,
        avg: round3(slice.reduce((a, b) => a + b, 0) / slice.length),
        min: round3(Math.min(...slice)),
        max: round3(Math.max(...slice)),
        tags: [],
      });
    }
    i = j;
  }

  const shorts = segs.filter((s) => s.duration < SHORT_MIN);
  for (const seg of segs) {
    const tags: Tag[] = [];
    const isStart = seg.start === 0;
    const isEnd = seg.end >= DAY_MINUTES;
    if (isStart) tags.push({ k: "day_start", t: "하루 시작 정지", h: "07:00 시작 시점부터 멈춰 있음" });
    if (isEnd) tags.push({ k: "day_end", t: "하루 끝 정지", h: "익일 07:00 까지 멈춘 상태로 종료" });
    const nearShift = [...SHIFT_CHANGES_MIN, DAY_MINUTES].some(
      (m) => seg.start < m + SHIFT_WINDOW_MIN && seg.end > m - SHIFT_WINDOW_MIN,
    );
    if (nearShift && !isStart && !isEnd) tags.push({ k: "shift", t: "교대 시간대", h: "07:00/19:00 교대 ±30분과 겹침" });
    if (seg.duration >= LONG_MIN) tags.push({ k: "long", t: "장시간 정지", h: `${seg.duration}분 (기준 ${LONG_MIN}분)` });
    if (seg.duration < SHORT_MIN) {
      const near = shorts.filter((o) => Math.abs(o.start - seg.start) <= 60).length;
      if (near >= 3) tags.push({ k: "short_rep", t: "짧은 비가동 반복", h: `±60분 내 ${near}회` });
    }
    if (!isStart && !isEnd && seg.duration >= CHG_MIN && seg.duration <= CHG_MAX) {
      tags.push({ k: "change", t: "교체 후보", h: `${CHG_MIN}~${CHG_MAX}분 정지 — 금형/품종 교체 가능성` });
    }
    seg.tags = tags;
  }
  return segs;
}

export type SuggestContext = {
  hasMoldToday: boolean;
  defectRate: number | null;
  /** 해당 분에 같은 공장 가동 대상 설비 중 비가동/정지 비율 */
  factoryDownRatio: (minute: number) => number;
};

/** 태그 기반 원인 자동 추천 (§6.5) */
export function suggestCause(seg: Segment, ctx: SuggestContext): string | null {
  const has = (k: string) => seg.tags.some((t) => t.k === k);
  if (has("day_end") && ctx.hasMoldToday) return "PLN_END";
  if (has("day_start")) return "PLN_PREP";
  const mid = Math.floor((seg.start + seg.end) / 2);
  if (ctx.factoryDownRatio(mid) >= 0.5) return "UTL_POWER";
  if (has("change")) return "MOLD_CHG";
  if (has("short_rep")) return "BRK_SHORT";
  if (ctx.defectRate != null && ctx.defectRate >= 0.05) return "QLT_ADJ";
  return null;
}

export function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}
export function round1(v: number) {
  return Math.round(v * 10) / 10;
}
