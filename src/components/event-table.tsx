"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { api, emitChange, getOperator } from "@/lib/client";
import { minuteToClock } from "@/lib/time";
import { cn, num } from "@/lib/utils";
import type { EventRow } from "@/lib/queries/dashboard";
import { Button, Checkbox, Empty, ErrorBox } from "./ui";
import { CauseBadge, StateBadge, Tags } from "./domain";
import { CausePicker } from "./cause-picker";

export function EventTable({
  events,
  onChanged,
  showEquipment,
  showDate,
  highlightId,
  onHover,
  emptyText = "비가동 구간이 없습니다",
}: {
  events: EventRow[];
  onChanged: () => void;
  showEquipment?: boolean;
  showDate?: boolean;
  highlightId?: number | null;
  onHover?: (e: EventRow | null) => void;
  emptyText?: string;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hlRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    setSel((s) => new Set([...s].filter((id) => events.some((e) => e.id === id))));
  }, [events]);
  useEffect(() => {
    if (highlightId) hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, events.length]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setEditing(null);
      onChanged();
      emitChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const by = () => getOperator() || undefined;
  const save = (id: number, code: string | null, memo: string) =>
    run(() => api(`/api/events/${id}`, { method: "PATCH", json: { cause_code: code, memo, by: by() } }));
  const accept = (id: number) => run(() => api(`/api/events/${id}/accept-suggestion`, { method: "POST", json: { by: by() } }));
  const bulk = (code: string | null, memo: string) =>
    run(async () => {
      await api(`/api/events/bulk`, { method: "PATCH", json: { ids: [...sel], cause_code: code, memo: memo || undefined, by: by() } });
      setSel(new Set());
    });
  const bulkAccept = () =>
    run(async () => {
      await api(`/api/events/bulk`, { method: "PATCH", json: { ids: [...sel], acceptSuggestions: true, by: by() } });
      setSel(new Set());
    });

  if (!events.length) return <Empty>{emptyText}</Empty>;
  const allSel = sel.size === events.length;
  const selSuggested = events.filter((e) => sel.has(e.id) && !e.causeCode && e.suggestedCauseCode).length;

  return (
    <div>
      {sel.size > 0 && (
        <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size}개 구간 일괄 분류</span>
          <CausePicker onSubmit={bulk} submitLabel="일괄 적용" busy={busy} compact />
          {selSuggested > 0 && (
            <Button size="sm" variant="outline" onClick={bulkAccept} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> 추천 원인 {selSuggested}건 확정
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            선택 해제
          </Button>
        </div>
      )}
      {err && <div className="p-2"><ErrorBox error={err} /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox checked={allSel} onChange={(v) => setSel(v ? new Set(events.map((e) => e.id)) : new Set())} />
              </th>
              {showDate && <th className="px-2 py-2">일자</th>}
              {showEquipment && <th className="px-2 py-2">설비</th>}
              <th className="px-2 py-2">시간</th>
              <th className="px-2 py-2">상태</th>
              <th className="px-2 py-2 text-right">지속</th>
              <th className="px-2 py-2 text-right">평균 전류</th>
              <th className="px-2 py-2 text-right">손실(개)</th>
              <th className="px-2 py-2">태그</th>
              <th className="px-2 py-2">원인</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const hl = highlightId === e.id;
              return (
                <tr
                  key={e.id}
                  ref={hl ? hlRef : undefined}
                  onMouseEnter={() => onHover?.(e)}
                  onMouseLeave={() => onHover?.(null)}
                  className={cn("border-t border-zinc-100 align-top hover:bg-zinc-50", hl && "bg-amber-50 ring-2 ring-inset ring-amber-300", sel.has(e.id) && "bg-sky-50")}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={sel.has(e.id)}
                      onChange={(v) =>
                        setSel((s) => {
                          const n = new Set(s);
                          if (v) n.add(e.id);
                          else n.delete(e.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  {showDate && <td className="px-2 py-2 tabular text-zinc-600">{e.date.slice(5)}</td>}
                  {showEquipment && (
                    <td className="px-2 py-2 font-medium">
                      <Link className="hover:underline" href={`/equipment/${encodeURIComponent(e.code)}?date=${e.date}&event=${e.id}`}>
                        {e.code}
                      </Link>
                    </td>
                  )}
                  <td className="px-2 py-2 tabular whitespace-nowrap">
                    {minuteToClock(e.startMinute)}~{minuteToClock(e.endMinute)}
                  </td>
                  <td className="px-2 py-2"><StateBadge state={e.state} /></td>
                  <td className="px-2 py-2 text-right tabular font-medium">{e.duration}분</td>
                  <td className="px-2 py-2 text-right tabular text-zinc-600" title={`최소 ${e.minCurrent}A / 최대 ${e.maxCurrent}A`}>
                    {num(e.avgCurrent, 1)}A
                  </td>
                  <td className="px-2 py-2 text-right tabular text-zinc-600">{e.lostUnits != null ? num(e.lostUnits) : "–"}</td>
                  <td className="px-2 py-2"><Tags tags={e.tags} /></td>
                  <td className="px-2 py-2">
                    {editing === e.id ? (
                      <CausePicker
                        initial={e.causeCode}
                        initialMemo={e.memo}
                        onSubmit={(c, m) => save(e.id, c, m)}
                        onCancel={() => setEditing(null)}
                        busy={busy}
                        compact
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button onClick={() => setEditing(e.id)} className="group inline-flex items-center gap-1" title="원인 기록">
                          <CauseBadge name={e.causeName} category={e.categoryName} color={e.causeColor} />
                          <Pencil className="h-3 w-3 text-zinc-400 opacity-0 group-hover:opacity-100" />
                        </button>
                        {!e.causeCode && e.suggestedCauseCode && (
                          <button
                            disabled={busy}
                            onClick={() => accept(e.id)}
                            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800"
                            title="자동 추천 원인 — 클릭하면 확정"
                          >
                            추천: {e.suggestedName} <Check className="h-3 w-3" />
                          </button>
                        )}
                        {e.memo && <span className="text-xs text-zinc-500">“{e.memo}”</span>}
                        {e.classifiedBy && <span className="text-[11px] text-zinc-400">· {e.classifiedBy}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
