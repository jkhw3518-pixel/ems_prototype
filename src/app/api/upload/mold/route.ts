import { handler, HttpError, isDate, json } from "@/lib/api";
import { dateFromFileName, parseMoldWorkbook } from "@/lib/parsers";
import { analyzeAndAlert, ingestMold, logUpload } from "@/lib/ingest";
import { datesWithReadings } from "@/lib/engine/analyze";

export const maxDuration = 60;

export const POST = handler(async (req, db) => {
  const form = await req.formData();
  const forced = form.get("date");
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (!files.length) throw new HttpError(400, "업로드할 파일이 없습니다");
  const out = [];
  const allDates = new Set<string>();
  for (const f of files) {
    const fallback = isDate(forced) ? forced : dateFromFileName(f.name);
    let parsed;
    try {
      parsed = parseMoldWorkbook(await f.arrayBuffer(), fallback);
    } catch (e) {
      out.push({ file: f.name, saved: 0, error: `엑셀 파싱 실패: ${e instanceof Error ? e.message : e}` });
      continue;
    }
    const r = await ingestMold(db, parsed.rows);
    r.dates.forEach((d) => allDates.add(d));
    const msg = [...parsed.warnings, ...(r.unknown.length ? [`미등록 설비 무시: ${r.unknown.join(", ")}`] : [])].join(" / ") || undefined;
    await logUpload(db, "mold", f.name, r.saved, r.dates, msg);
    out.push({ file: f.name, saved: r.saved, skipped: parsed.skipped, unknown: r.unknown, dates: r.dates, warnings: parsed.warnings });
  }
  // 리딩이 있는 날만 재분석 (손실 추정 활성화)
  const withReadings = new Set(await datesWithReadings(db));
  const analysis = await analyzeAndAlert(db, [...allDates].filter((d) => withReadings.has(d)).sort());
  return json({ files: out, analysis });
});
