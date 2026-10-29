import { handler, HttpError, json } from "@/lib/api";
import { parseEmsJson } from "@/lib/parsers";
import { analyzeAndAlert, ingestEms, logUpload } from "@/lib/ingest";

export const maxDuration = 60;

export const POST = handler(async (req, db) => {
  const ct = req.headers.get("content-type") ?? "";
  const files: { name: string; data: unknown }[] = [];
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const f of form.getAll("file")) {
      if (typeof f === "string") continue;
      try {
        files.push({ name: f.name, data: JSON.parse(await f.text()) });
      } catch {
        throw new HttpError(400, `${f.name}: JSON 파싱 실패`);
      }
    }
  } else {
    files.push({ name: "request-body.json", data: await req.json() });
  }
  if (!files.length) throw new HttpError(400, "업로드할 파일이 없습니다");

  const out = [];
  const allDates = new Set<string>();
  for (const f of files) {
    const { points, skipped } = parseEmsJson(f.data);
    if (!points.length) {
      await logUpload(db, "ems", f.name, 0, [], "인식 가능한 전류 데이터 없음");
      out.push({ file: f.name, saved: 0, skipped, unknown: [], dates: [], error: "인식 가능한 전류 데이터가 없습니다 (형식 확인)" });
      continue;
    }
    const r = await ingestEms(db, points);
    r.dates.forEach((d) => allDates.add(d));
    const msg = r.unknown.length ? `미등록 설비 무시: ${r.unknown.join(", ")}` : undefined;
    await logUpload(db, "ems", f.name, r.saved, r.dates, msg);
    out.push({ file: f.name, saved: r.saved, skipped, unknown: r.unknown, dates: r.dates });
  }
  const analysis = await analyzeAndAlert(db, [...allDates].sort());
  return json({ files: out, analysis });
});
