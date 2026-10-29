"use client";

import { Badge } from "./ui";
import { cn, durationText, pct, VERDICT_LABEL, verdictOf, type Verdict } from "@/lib/utils";
import type { Tag } from "@/db/schema";

export const STATE_COLOR = { run: "var(--run)", idle: "var(--idle)", stop: "var(--stop)" } as const;

export function StateBadge({ state }: { state: string }) {
  return state === "stop" ? (
    <Badge className="bg-rose-100 text-rose-700">● 완전정지</Badge>
  ) : state === "idle" ? (
    <Badge className="bg-amber-100 text-amber-800">◐ 비가동</Badge>
  ) : (
    <Badge className="bg-emerald-100 text-emerald-700">○ 정상가동</Badge>
  );
}

const VERDICT_CLS: Record<Verdict, string> = {
  good: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-rose-100 text-rose-700",
};
export function VerdictBadge({ util, className }: { util: number | null | undefined; className?: string }) {
  const v = verdictOf(util);
  return <Badge className={cn(VERDICT_CLS[v], className)}>{VERDICT_LABEL[v]}</Badge>;
}

export function CauseBadge({ name, category, color }: { name?: string | null; category?: string | null; color?: string | null }) {
  if (!name) return <Badge className="border border-dashed border-zinc-300 bg-white text-zinc-500">미분류</Badge>;
  return (
    <Badge color={color ?? undefined} title={category ? `${category} > ${name}` : name}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color ?? "#999" }} />
      {category && category !== name ? `${category} · ` : ""}
      {name}
    </Badge>
  );
}

export function Tags({ tags }: { tags: Tag[] | null | undefined }) {
  if (!tags?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t.k} title={t.h} className="bg-sky-50 text-sky-700">
          {t.t}
        </Badge>
      ))}
    </span>
  );
}

/** 정상/비가동/정지 구성 스택 바 */
export function StackBar({ run, idle, stop, planned = 0, className }: { run: number; idle: number; stop: number; planned?: number; className?: string }) {
  const total = run + idle + stop || 1;
  const seg = (v: number, c: string, label: string) =>
    v > 0 && <div style={{ width: `${(v / total) * 100}%`, background: c }} title={`${label} ${durationText(v)} (${pct(v / total)})`} />;
  return (
    <div className={cn("flex h-3 w-full overflow-hidden rounded-sm bg-zinc-100", className)}>
      {seg(run, STATE_COLOR.run, "정상가동")}
      {seg(idle, STATE_COLOR.idle, "비가동")}
      {seg(stop, STATE_COLOR.stop, "완전정지")}
      {planned > 0 && <span className="sr-only">계획정지 {planned}분</span>}
    </div>
  );
}

/** 경량 스파크라인 (null 은 끊긴 선) */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  className,
  color = "#3f3f46",
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
  color?: string;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 1) return <span className="text-xs text-zinc-400">–</span>;
  const min = Math.min(...nums, 0.5);
  const max = Math.max(...nums, 1);
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2);
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const paths: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (cur) paths.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) paths.push(cur);
  const lastIdx = values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop()!;
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      ))}
      <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={2} fill={color} />
    </svg>
  );
}

export function Kpi({ label, value, unit, sub, className }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm", className)}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular text-zinc-900">{value}</span>
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
