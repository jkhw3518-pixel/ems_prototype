"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, CardHeader, ErrorBox, Input, Spinner, Toggle } from "../ui";
import { loadCauses, type CauseCategory } from "../cause-picker";

export function CausesTab() {
  const [cats, setCats] = useState<CauseCategory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, { code: string; name: string }>>({});
  const reload = () => loadCauses(true).then((d) => setCats(d.categories));
  useEffect(() => {
    reload();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const put = (code: string, json: unknown) => run(() => api(`/api/causes/${code}`, { method: "PUT", json }));

  if (!cats) return <Spinner />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        대분류 9종 + 세부원인 2단 구조. <b>계획정지</b>로 표시된 원인은 &quot;계획정지 제외 가동율&quot;의 분모에서 빠지고, 알림의 &quot;계획정지 제외&quot; 대상이 됩니다.
        원인은 삭제할 수 없고 비활성화만 가능합니다 (과거 기록 보존). 금형교체·품종교체는 SMED 단축 대상으로 기본값이 비계획입니다.
      </p>
      {err && <ErrorBox error={err} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {cats.map((c) => {
          const add = adding[c.category];
          const first = c.causes[0];
          return (
            <Card key={c.category}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) => put(first.code, { color: e.target.value, isPlanned: c.isPlanned, applyToCategory: true })}
                      className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                      title="대분류 색상"
                    />
                    {c.categoryName} <span className="text-xs font-normal text-zinc-400">{c.category}</span>
                  </span>
                }
                right={
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    계획정지
                    <Toggle checked={c.isPlanned} onChange={(v) => put(first.code, { isPlanned: v, color: c.color, applyToCategory: true })} />
                  </label>
                }
              />
              <ul className="divide-y divide-zinc-50">
                {c.causes.map((x) => (
                  <li key={x.code} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                    <code className="w-28 text-xs text-zinc-500">{x.code}</code>
                    <Input
                      defaultValue={x.name}
                      className="h-8 flex-1 text-sm"
                      onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && put(x.code, { name: e.target.value })}
                    />
                    {!x.active && <Badge>비활성</Badge>}
                    <Toggle checked={x.active} onChange={(v) => put(x.code, { active: v })} title="사용 여부" />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-2">
                {add ? (
                  <>
                    <Input placeholder="코드 (예: BRK_SENSOR)" value={add.code} onChange={(e) => setAdding({ ...adding, [c.category]: { ...add, code: e.target.value.toUpperCase() } })} className="h-8 w-40 text-xs" />
                    <Input placeholder="세부 원인명" value={add.name} onChange={(e) => setAdding({ ...adding, [c.category]: { ...add, name: e.target.value } })} className="h-8 flex-1 text-xs" />
                    <Button
                      size="sm"
                      onClick={() =>
                        run(async () => {
                          await api("/api/causes", { method: "POST", json: { ...add, category: c.category } });
                          setAdding(({ [c.category]: _, ...r }) => r);
                        })
                      }
                    >
                      추가
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding(({ [c.category]: _, ...r }) => r)}>취소</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setAdding({ ...adding, [c.category]: { code: `${first.code.split("_")[0]}_`, name: "" } })}>
                    + 세부원인 추가
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
