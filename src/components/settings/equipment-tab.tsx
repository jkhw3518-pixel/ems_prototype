"use client";

import { useState } from "react";
import { api, useApi } from "@/lib/client";
import type { criteria, equipment } from "@/db/schema";
import { Button, Card, CardHeader, ErrorBox, Input, Select, Spinner, Toggle } from "../ui";

type Equip = typeof equipment.$inferSelect;
type Crit = typeof criteria.$inferSelect;

export function EquipmentTab() {
  const q = useApi<Equip[]>("/api/equipment");
  const crit = useApi<Crit[]>("/api/criteria");
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", factory: "1공장", group: "" });

  const update = async (code: string, patch: Partial<Equip>) => {
    setErr(null);
    try {
      await api(`/api/equipment/${encodeURIComponent(code)}`, { method: "PUT", json: patch });
      q.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const add = async () => {
    setErr(null);
    try {
      await api("/api/equipment", { method: "POST", json: form });
      setForm({ ...form, code: "" });
      q.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!q.data) return <Spinner />;
  const groups = crit.data?.map((c) => c.group) ?? [];
  return (
    <Card>
      <CardHeader title={`설비 마스터 (${q.data.length}대)`} desc="비활성 설비는 분석·알림 대상에서 빠집니다. 그룹은 판정 기준과 연결됩니다." />
      {err && <div className="p-3"><ErrorBox error={err} /></div>}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <Input placeholder="설비 코드 (예: PET-19)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-40" />
        <Select value={form.factory} onChange={(e) => setForm({ ...form, factory: e.target.value })}>
          <option>1공장</option>
          <option>2공장</option>
        </Select>
        <Select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}>
          <option value="">그룹 선택</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </Select>
        <Button onClick={add} disabled={!form.code || !form.group}>설비 추가</Button>
      </div>
      <div className="grid gap-x-6 p-2 md:grid-cols-2">
        {q.data.map((e) => (
          <div key={e.id} className="flex items-center gap-2 border-b border-zinc-50 px-2 py-1.5 text-sm">
            <span className="w-16 font-medium">{e.code}</span>
            <Select className="h-8 text-xs" value={e.factory} onChange={(x) => update(e.code, { factory: x.target.value })}>
              <option>1공장</option>
              <option>2공장</option>
            </Select>
            <Select className="h-8 text-xs" value={e.group} onChange={(x) => update(e.code, { group: x.target.value })}>
              {[...new Set([...groups, e.group])].map((g) => <option key={g}>{g}</option>)}
            </Select>
            <Input
              type="number"
              className="h-8 w-16 text-xs"
              defaultValue={e.displayOrder}
              title="표시 순서"
              onBlur={(x) => Number(x.target.value) !== e.displayOrder && update(e.code, { displayOrder: Number(x.target.value) })}
            />
            <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
              {e.active ? "사용" : "중지"}
              <Toggle checked={e.active} onChange={(v) => update(e.code, { active: v })} />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
