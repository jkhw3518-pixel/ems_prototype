"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Button, Input, Select } from "./ui";

export type Cause = {
  code: string;
  category: string;
  categoryName: string;
  name: string;
  isPlanned: boolean;
  color: string;
  displayOrder: number;
  active: boolean;
};
export type CauseCategory = { category: string; categoryName: string; color: string; isPlanned: boolean; causes: Cause[] };

let cache: Promise<{ categories: CauseCategory[]; causes: Cause[] }> | null = null;
export function loadCauses(force = false) {
  if (!cache || force) cache = api("/api/causes");
  return cache;
}

export function useCauses() {
  const [data, setData] = useState<{ categories: CauseCategory[]; causes: Cause[] } | null>(null);
  useEffect(() => {
    loadCauses().then(setData).catch(() => setData({ categories: [], causes: [] }));
  }, []);
  return data;
}

/** 대분류 → 세부원인 2단 선택 (§5.2) */
export function CausePicker({
  initial,
  initialMemo,
  onSubmit,
  onCancel,
  submitLabel = "저장",
  busy,
  compact,
}: {
  initial?: string | null;
  initialMemo?: string | null;
  onSubmit: (code: string | null, memo: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
  busy?: boolean;
  compact?: boolean;
}) {
  const data = useCauses();
  const initCat = useMemo(() => data?.causes.find((c) => c.code === initial)?.category ?? "", [data, initial]);
  const [cat, setCat] = useState("");
  const [code, setCode] = useState(initial ?? "");
  const [memo, setMemo] = useState(initialMemo ?? "");
  useEffect(() => setCat(initCat), [initCat]);

  const cats = data?.categories ?? [];
  const causes = cats.find((c) => c.category === cat)?.causes.filter((c) => c.active || c.code === initial) ?? [];
  const needMemo = code === "ETC" && !memo.trim();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={cat}
        onChange={(e) => {
          setCat(e.target.value);
          const first = cats.find((c) => c.category === e.target.value)?.causes.filter((c) => c.active);
          setCode(first?.length === 1 ? first[0].code : "");
        }}
        className={compact ? "h-8 text-xs" : ""}
      >
        <option value="">대분류 선택</option>
        {cats.map((c) => (
          <option key={c.category} value={c.category}>
            {c.categoryName}
            {c.isPlanned ? " (계획)" : ""}
          </option>
        ))}
      </Select>
      <Select value={code} onChange={(e) => setCode(e.target.value)} disabled={!cat} className={compact ? "h-8 text-xs" : ""}>
        <option value="">세부원인</option>
        {causes.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
      <Input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder={code === "ETC" ? "메모 (필수)" : "메모 (선택)"}
        className={compact ? "h-8 w-40 text-xs" : "w-48"}
      />
      <Button size="sm" disabled={!code || needMemo || busy} onClick={() => onSubmit(code, memo)} title={needMemo ? "'기타'는 메모가 필수입니다" : undefined}>
        {submitLabel}
      </Button>
      {initial && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSubmit(null, memo)}>
          분류 해제
        </Button>
      )}
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      )}
    </div>
  );
}
