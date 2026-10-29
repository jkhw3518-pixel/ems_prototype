"use client";

import { useEffect, useState } from "react";
import { addDays } from "@/lib/time";
import { useApi } from "@/lib/client";
import { Button, Input, Segmented, Select } from "./ui";

export type RangeFilter = { from: string; to: string; factory: string; equipment: string };

/** 최근 분석일 기준 기본 기간 */
export function useDefaultRange(days: number) {
  const meta = useApi<{ dates: string[] }>("/api/meta");
  const [f, setF] = useState<RangeFilter | null>(null);
  useEffect(() => {
    if (f || !meta.data) return;
    // URL 로 넘어온 기간/설비 (추세 화면에서 점 클릭 등)
    const sp = new URLSearchParams(window.location.search);
    const isD = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const to = isD(sp.get("to")) ? sp.get("to")! : (meta.data.dates[0] ?? new Date().toISOString().slice(0, 10));
    const from = isD(sp.get("from")) ? sp.get("from")! : addDays(to, -(days - 1));
    setF({ from, to, factory: sp.get("factory") ?? "", equipment: sp.get("equipment") ?? "" });
  }, [meta.data, f, days]);
  return { filter: f, setFilter: setF, latest: meta.data?.dates[0] ?? null };
}

export function RangeBar({ value, onChange, presets = [7, 30, 90] }: { value: RangeFilter; onChange: (v: RangeFilter) => void; presets?: number[] }) {
  const eq = useApi<{ code: string; factory: string }[]>("/api/equipment");
  const list = (eq.data ?? []).filter((e) => !value.factory || e.factory === value.factory);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <span className="text-zinc-400">~</span>
      <Input type="date" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      {presets.map((p) => (
        <Button key={p} size="sm" variant="ghost" onClick={() => onChange({ ...value, from: addDays(value.to, -(p - 1)) })}>
          최근 {p}일
        </Button>
      ))}
      <Segmented
        value={value.factory}
        onChange={(v) => onChange({ ...value, factory: v, equipment: "" })}
        options={[
          { value: "", label: "전체" },
          { value: "1공장", label: "1공장" },
          { value: "2공장", label: "2공장" },
        ]}
      />
      <Select value={value.equipment} onChange={(e) => onChange({ ...value, equipment: e.target.value })}>
        <option value="">설비 전체</option>
        {list.map((e) => (
          <option key={e.code} value={e.code}>
            {e.code}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function filterQs(f: RangeFilter, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (f.factory) q.set("factory", f.factory);
  if (f.equipment) q.set("equipment", f.equipment);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}
