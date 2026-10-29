// pnpm test — 파서·분석 엔진 자체 점검 (DB 불필요). samples/ 에 업로드 예시 파일도 생성한다.
import * as XLSX from "xlsx";
import { writeFileSync } from "fs";
import { parseEmsJson, parseMoldWorkbook, normalizeCode, dateFromFileName } from "../src/lib/parsers";
import { classify, detectSegments } from "../src/lib/engine/core";
import { analysisDateOf, isoWeek, minuteToClock } from "../src/lib/time";
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
ok(normalizeCode("pet 01") === "PET-1" && normalizeCode("S3") === "S-3" && normalizeCode("A-1") === "A-1", "normalizeCode");
const a = parseEmsJson([{ code: "PET-1", time: "2026-10-13 07:00", value: 61.2 }]);
ok(a.points.length === 1 && a.points[0].ts.toISOString() === "2026-10-12T22:00:00.000Z", "1) records, KST default");
const b = parseEmsJson({ "PET-1": [["2026-10-13T07:01:00", 1], ["2026-10-13T07:02:00+09:00", 2]], "S 2": [{ t: "2026-10-13 07:00", v: 3 }] });
ok(b.points.length === 3 && b.points.some(p => p.code === "S-2"), "2) map");
const c = parseEmsJson({ data: [{ time: "2026/10/13 07:00", "PET-1": 61.2, "PET-2": 0, note: "x" }] });
ok(c.points.length === 2, "3) wide (nested under data)");
const d = parseEmsJson({ code: "PET-1", start: "2026-10-13 07:00", values: [1, 2, 3] });
ok(d.points.length === 3 && d.points[2].ts.toISOString() === "2026-10-12T22:02:00.000Z", "4) start+values");
const e = parseEmsJson([{ 설비: "PE-2", 시각: "2026-10-13 08:00", 전류: "12.5" }]);
ok(e.points[0]?.code === "PE-2" && e.points[0].value === 12.5, "Korean keys");
ok(analysisDateOf(new Date("2026-10-13T21:59:00Z")) === "2026-10-13" && analysisDateOf(new Date("2026-10-13T22:00:00Z")) === "2026-10-14", "analysis day boundary 07:00 KST");
ok(isoWeek("2026-10-19").key === "2026-W43" && isoWeek("2026-10-25").start === "2026-10-19", "iso week");
ok(minuteToClock(0) === "07:00" && minuteToClock(1439) === "06:59", "clock");
// classify: idle shorter than duration → run; whole-day rule
const raw: (number | null)[] = Array(1440).fill(70);
for (let i = 100; i < 103; i++) raw[i] = 30;   // 3분 idle (<5) → run
for (let i = 200; i < 260; i++) raw[i] = 30;   // 60분 idle
for (let i = 500; i < 530; i++) raw[i] = 0;    // 30분 stop → 교체 후보
raw[700] = null;                                // 1분 결측 → 보정
const r = classify(raw, { stop: 5, idle: 60, duration: 5 });
ok(r.idle === 60 && r.stop === 30 && r.run === 1350 && !r.excluded, `classify run/idle/stop ${r.run}/${r.idle}/${r.stop}`);
const segs = detectSegments(r);
ok(segs.length === 2 && segs[0].tags.some(t => t.k === "long") && segs[1].tags.some(t => t.k === "change"), "segments + tags");
const off = classify(Array(1440).fill(0).map((v, i) => (i < 8 ? 70 : 0)), { stop: 5, idle: 60, duration: 5 });
ok(off.wholeDayStop && off.excluded, "whole-day stop → excluded");
const partial = classify([...Array(540).fill(70), ...Array(900).fill(null)], { stop: 5, idle: 60, duration: 5 });
ok(partial.target === 540 && partial.partial && partial.run === 540, "partial day target");
// MOLD xlsx
const ws = XLSX.utils.aoa_to_sheet([
  ["새한프라텍 MOLD 생산실적"], [],
  ["생산일자", "부서코드", "설비", "작업지시번호", "품명", "CAPA'(12HR)", "총투입수", "양품수"],
  ["2026-10-13", "1211", "PET-1", "WO-001", "생수 500ml", 9000, 7800, 7650],
  ["2026-10-13", "1211", "pet 2", "WO-002", "생수 2L", 6000, 5000, 4700],
  ["합계", "", "", "", "", "", 12800, 12350],
]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "실적");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xls" }) as Buffer;
writeFileSync("samples/MOLD_20261013_sample.xls", buf);
const m = parseMoldWorkbook(new Uint8Array(buf).buffer);
ok(m.rows.length === 2 && m.rows[1].code === "PET-2" && m.rows[0].capa12hr === 9000 && m.rows[0].date === "2026-10-13", `mold xls parse (${m.rows.length} rows, warn ${m.warnings.length})`);
ok(dateFromFileName("MOLD_20261013.xls") === "2026-10-13", "date from filename");
// EMS 업로드 예시 (레코드 배열 형식, 2026-10-20 하루, 3대)
const sample: { code: string; time: string; value: number }[] = [];
for (const [code, base, stopAt] of [["PET-1", 75, 300], ["S-2", 48, 900], ["P-2", 62, -1]] as const) {
  for (let m = 0; m < 1440; m++) {
    const t = new Date(Date.UTC(2026, 9, 19, 22, m)); // 2026-10-20 07:00 KST + m
    const kst = new Date(t.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    const down = stopAt >= 0 && m >= stopAt && m < stopAt + 45;
    sample.push({ code, time: kst, value: down ? 0.4 : Math.round((base + Math.sin(m / 7) * 3) * 10) / 10 });
  }
}
writeFileSync("samples/EMS_20261020_sample.json", JSON.stringify(sample));
