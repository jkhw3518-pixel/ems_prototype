import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ST_GOOD, ST_WARN, TREND_FLAT_PP } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pct = (v: number | null | undefined, d = 1) => (v == null || isNaN(v) ? "–" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 0) =>
  v == null || isNaN(v) ? "–" : v.toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d });
export const hours = (min: number) => (min / 60).toFixed(1);
export const durationText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`);

export type Verdict = "good" | "warn" | "bad";
export function verdictOf(u: number | null | undefined): Verdict {
  if (u == null) return "bad";
  return u >= ST_GOOD ? "good" : u >= ST_WARN ? "warn" : "bad";
}
export const VERDICT_LABEL: Record<Verdict, string> = { good: "양호", warn: "주의", bad: "점검" };

export type Direction = "up" | "down" | "flat" | "none";

/** 증감(%p) → 방향 (§10.4) */
export function deltaDirection(pp: number | null | undefined, flat = TREND_FLAT_PP): Direction {
  if (pp == null || isNaN(pp)) return "none";
  if (pp > flat) return "up";
  if (pp < -flat) return "down";
  return "flat";
}

/** 가동율 두 값의 차이 → %p (소수 1자리) */
export function ppDelta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 1000) / 10;
}

export function deltaArrowText(pp: number | null | undefined, unit = "%p") {
  const dir = deltaDirection(pp);
  if (dir === "none") return "–";
  const icon = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
  const v = Math.abs(pp!).toFixed(1);
  return `${icon} ${dir === "up" ? "+" : dir === "down" ? "−" : ""}${v}${unit}`;
}
