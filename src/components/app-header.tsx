"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Factory, UserRound } from "lucide-react";
import { api, getOperator, setOperator } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "대시보드" },
  { href: "/causes", label: "원인 분석" },
  { href: "/trends", label: "추세" },
  { href: "/alerts", label: "알림 이력" },
  { href: "/upload", label: "데이터 업로드" },
  { href: "/settings", label: "설정" },
];

export function AppHeader() {
  const path = usePathname();
  const [unacked, setUnacked] = useState(0);
  const [dbMode, setDbMode] = useState<string | null>(null);
  const [op, setOp] = useState("");

  useEffect(() => {
    setOp(getOperator());
    const load = () =>
      api<{ unackedAlerts: number; dbMode: string }>("/api/meta")
        .then((m) => {
          setUnacked(m.unackedAlerts);
          setDbMode(m.dbMode);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("ems-change", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("ems-change", load);
    };
  }, [path]);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900">
          <Factory className="h-5 w-5 text-emerald-600" />
          <span>새한프라텍 EMS <span className="font-normal text-zinc-500">비가동 분석</span></span>
        </Link>
        <nav className="flex flex-1 flex-wrap gap-1 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn("rounded-md px-3 py-1.5", active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          {dbMode === "pglite" && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800" title="DATABASE_URL 미설정 — 로컬 PGlite 사용 중">
              로컬 DB
            </span>
          )}
          <label className="flex items-center gap-1 text-xs text-zinc-500" title="원인 분류·알림 확인 시 입력자로 기록됩니다">
            <UserRound className="h-4 w-4" />
            <input
              value={op}
              onChange={(e) => {
                setOp(e.target.value);
                setOperator(e.target.value);
              }}
              placeholder="작업자 이름"
              className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-zinc-800 hover:border-zinc-200 focus:border-zinc-300 focus:outline-none"
            />
          </label>
          <Link href="/alerts?status=unacked" className="relative rounded-md p-1.5 hover:bg-zinc-100" title="미확인 알림">
            <Bell className="h-5 w-5 text-zinc-700" />
            {unacked > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                {unacked > 99 ? "99+" : unacked}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
