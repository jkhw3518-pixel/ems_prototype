import { cn, deltaDirection } from "@/lib/utils";

/**
 * 증감 화살표 공통 컴포넌트 (§10.4)
 * - 가동율처럼 높을수록 좋은 지표: ▲ 초록 / ▼ 빨강
 * - inverse: 비가동 시간·손실 수량처럼 낮을수록 좋은 지표는 색상 반전
 * - 색상과 함께 아이콘 모양으로도 구분 (색각 이상 대응)
 */
export function DeltaArrow({
  value,
  inverse = false,
  unit = "%p",
  flat,
  digits = 1,
  className,
  label,
}: {
  value: number | null | undefined;
  inverse?: boolean;
  unit?: string;
  flat?: number;
  digits?: number;
  className?: string;
  label?: string;
}) {
  const dir = deltaDirection(value, flat);
  if (dir === "none") return <span className={cn("text-xs text-zinc-400", className)} title="비교 데이터 없음">–</span>;
  const good = dir === "flat" ? null : (dir === "up") !== inverse;
  const icon = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular whitespace-nowrap",
        good === null ? "text-zinc-500" : good ? "text-emerald-600" : "text-rose-600",
        className,
      )}
      title={label}
    >
      <span aria-hidden className="text-[10px]">{icon}</span>
      {label && <span className="sr-only">{label}</span>}
      {sign}
      {Math.abs(value!).toFixed(digits)}
      {unit}
    </span>
  );
}
