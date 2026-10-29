"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileJson, FileSpreadsheet, UploadCloud } from "lucide-react";
import { emitChange, useApi } from "@/lib/client";
import { formatKst } from "@/lib/time";
import { cn, num } from "@/lib/utils";
import { Button, Card, CardHeader, Empty, ErrorBox, Input } from "@/components/ui";

type FileResult = { file: string; saved: number; skipped?: number; unknown?: string[]; dates?: string[]; error?: string; warnings?: string[] };
type AnalysisResult = { date: string; analyzed: number; running: number; excluded: number; events: number; error?: string; alerts?: { created: number; candidates: number } };
type UploadResponse = { files: FileResult[]; analysis: AnalysisResult[] };
type History = { id: number; kind: string; fileName: string; rowCount: number; dates: string[] | null; message: string | null; uploadedAt: string };

export default function UploadPage() {
  const hist = useApi<History[]>("/api/upload/history");
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [moldDate, setMoldDate] = useState("");

  const upload = async (kind: "ems" | "mold", files: File[]) => {
    if (!files.length) return;
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("file", f));
      if (kind === "mold" && moldDate) fd.append("date", moldDate);
      const res = await fetch(`/api/upload/${kind}`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      setResult(data);
      hist.reload();
      emitChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">데이터 업로드</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          icon={<FileJson className="h-8 w-8 text-emerald-600" />}
          title="EMS 전류 데이터 (.json)"
          desc="1분 단위 설비 전류. 업로드 후 해당 날짜 자동 분석 → 원인 추천 → 알림 평가"
          accept=".json,application/json"
          busy={busy === "ems"}
          onFiles={(f) => upload("ems", f)}
        />
        <DropZone
          icon={<FileSpreadsheet className="h-8 w-8 text-sky-600" />}
          title="MOLD 생산 실적 (.xls / .xlsx, 여러 개 가능)"
          desc="설비·작업지시·품명·총투입수·양품수·CAPA'(12HR) — 손실 수량 추정과 비생산 가동 탐지에 사용"
          accept=".xls,.xlsx"
          busy={busy === "mold"}
          onFiles={(f) => upload("mold", f)}
          extra={
            <label className="flex items-center gap-2 text-xs text-zinc-500" onClick={(e) => e.stopPropagation()}>
              생산일자 (파일에 일자 열이 없을 때)
              <Input type="date" value={moldDate} onChange={(e) => setMoldDate(e.target.value)} className="h-7 text-xs" />
            </label>
          }
        />
      </div>

      {error && <ErrorBox error={error} />}
      {result && <ResultCard r={result} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="지원하는 EMS JSON 형식" desc="시각에 타임존이 없으면 한국시간(KST)으로 해석합니다" />
          <pre className="overflow-x-auto px-4 py-3 text-[11px] leading-relaxed text-zinc-700">{`// 1) 레코드 배열
[{ "code": "PET-1", "time": "2026-10-13 07:00", "value": 61.2 }, ...]

// 2) 설비별 맵
{ "PET-1": [["2026-10-13T07:00:00", 61.2], ...], "S-2": [...] }

// 3) 와이드 형식 (시각 + 설비 열)
[{ "time": "2026-10-13 07:00", "PET-1": 61.2, "PET-2": 0 }, ...]

// 4) 시작 시각 + 1분 간격 값 배열
{ "code": "PET-1", "start": "2026-10-13 07:00", "values": [61.2, 60.8, ...] }

// 키 이름: code/equipment/설비, time/timestamp/recorded_at/시각,
//          value/current/전류 등 자동 인식. "PET 01" → "PET-1" 정규화`}</pre>
        </Card>
        <Card>
          <CardHeader title="업로드 이력" />
          {!hist.data?.length ? (
            <Empty>업로드 이력이 없습니다</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2">시각</th>
                  <th className="px-2 py-2">종류</th>
                  <th className="px-2 py-2">파일</th>
                  <th className="px-2 py-2 text-right">건수</th>
                  <th className="px-4 py-2">분석일</th>
                </tr>
              </thead>
              <tbody>
                {hist.data.map((h) => (
                  <tr key={h.id} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-2 tabular whitespace-nowrap text-zinc-600">{formatKst(h.uploadedAt)}</td>
                    <td className="px-2 py-2">{h.kind === "ems" ? "EMS" : "MOLD"}</td>
                    <td className="px-2 py-2">
                      <div className="max-w-[220px] truncate" title={h.fileName}>{h.fileName}</div>
                      {h.message && <div className="text-xs text-amber-700">{h.message}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular">{num(h.rowCount)}</td>
                    <td className="px-4 py-2 text-xs">
                      {(h.dates ?? []).map((d) => (
                        <Link key={d} href={`/?date=${d}`} className="mr-1 underline">
                          {d.slice(5)}
                        </Link>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function DropZone({
  icon, title, desc, accept, busy, onFiles, extra,
}: {
  icon: React.ReactNode; title: string; desc: string; accept: string; busy: boolean; onFiles: (f: File[]) => void; extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
      onClick={() => !busy && ref.current?.click()}
      className={cn("flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed px-6 py-8 text-center transition-colors", over ? "border-emerald-500 bg-emerald-50" : "border-zinc-300 hover:border-zinc-400")}
    >
      {busy ? <UploadCloud className="h-8 w-8 animate-bounce text-zinc-500" /> : icon}
      <div className="font-semibold">{busy ? "업로드 및 분석 중…" : title}</div>
      <p className="max-w-sm text-xs text-zinc-500">{desc}</p>
      <Button size="sm" variant="outline" disabled={busy} type="button">
        파일 선택 또는 끌어다 놓기
      </Button>
      {extra}
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </Card>
  );
}

function ResultCard({ r }: { r: UploadResponse }) {
  return (
    <Card>
      <CardHeader title="업로드 결과" />
      <div className="space-y-2 px-4 py-3 text-sm">
        {r.files.map((f) => (
          <div key={f.file} className={cn("rounded-md px-3 py-2", f.error ? "bg-rose-50 text-rose-700" : "bg-zinc-50")}>
            <span className="font-medium">{f.file}</span> — {f.error ?? `${num(f.saved)}건 저장`}
            {!!f.skipped && <span className="text-zinc-500"> · 인식 불가 {num(f.skipped)}건</span>}
            {!!f.unknown?.length && <div className="text-xs text-amber-700">미등록 설비 (설정 &gt; 설비에서 추가): {f.unknown.join(", ")}</div>}
            {!!f.warnings?.length && <div className="text-xs text-amber-700">{f.warnings.join(" / ")}</div>}
          </div>
        ))}
        {r.analysis.map((a) => (
          <div key={a.date} className="flex flex-wrap items-center gap-2">
            <Link href={`/?date=${a.date}`} className="font-medium underline">{a.date}</Link>
            {a.error ? (
              <span className="text-rose-600">분석 실패: {a.error}</span>
            ) : (
              <span className="text-zinc-600">
                분석 {a.analyzed}대 · 가동 {a.running}대 · 미가동 제외 {a.excluded}대 · 비가동 구간 {a.events}개
                {a.alerts && ` · 알림 ${a.alerts.created}건 발생`}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
