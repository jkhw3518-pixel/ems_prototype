import { DAY_START_HOUR } from "./constants";

// 모든 업무 시각은 KST(UTC+9, DST 없음) 기준.
const KST_OFFSET_MS = 9 * 3600_000;

/** 분석일 D 의 시작 시각 (D 07:00 KST) */
export function dayStart(date: string): Date {
  return new Date(`${date}T${String(DAY_START_HOUR).padStart(2, "0")}:00:00+09:00`);
}

export function dayEnd(date: string): Date {
  return new Date(dayStart(date).getTime() + 1440 * 60_000);
}

/** 임의 시각이 속한 분석일 (07:00 이전은 전날) */
export function analysisDateOf(ts: Date): string {
  const k = new Date(ts.getTime() + KST_OFFSET_MS - DAY_START_HOUR * 3600_000);
  return k.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400_000);
}

export function todayKst(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 경과분 → "HH:MM" (07:00 기준) */
export function minuteToClock(m: number): string {
  const total = (DAY_START_HOUR * 60 + m) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function minuteToTs(date: string, m: number): Date {
  return new Date(dayStart(date).getTime() + m * 60_000);
}

export function formatKst(ts: Date | string, withDate = true): string {
  const d = new Date(new Date(ts).getTime() + KST_OFFSET_MS).toISOString();
  return withDate ? `${d.slice(0, 10)} ${d.slice(11, 16)}` : d.slice(11, 16);
}

/** KST 현재 시각 "HH:MM:SS" */
export function kstClock(ts = new Date()): string {
  return new Date(ts.getTime() + KST_OFFSET_MS).toISOString().slice(11, 19);
}

/** 문자열/숫자 시각을 Date 로 (타임존 없는 값은 KST 로 해석) */
export function parseKstTimestamp(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // epoch seconds / millis
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/\//g, "-").replace(/\./g, "-");
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00";
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "+09:00";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** ISO 주차 "YYYY-Www" 와 주 시작(월요일) */
export function isoWeek(date: string): { key: string; start: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400_000)) + 1;
  return { key: `${year}-W${String(week).padStart(2, "0")}`, start: monday.toISOString().slice(0, 10) };
}

export type Granularity = "day" | "week" | "month";

export function periodOf(date: string, g: Granularity): { key: string; start: string; days: number } {
  if (g === "day") return { key: date, start: date, days: 1 };
  if (g === "week") {
    const w = isoWeek(date);
    return { ...w, days: 7 };
  }
  const start = `${date.slice(0, 7)}-01`;
  const [y, m] = date.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { key: date.slice(0, 7), start, days };
}

export function prevPeriodStart(start: string, g: Granularity): string {
  if (g === "day") return addDays(start, -1);
  if (g === "week") return addDays(start, -7);
  const [y, m] = start.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
