import * as XLSX from "xlsx";
import { parseKstTimestamp } from "./time";

export type EmsPoint = { code: string; ts: Date; value: number };

/** "pet 01", "PET1", "Pet-1" → "PET-1" */
export function normalizeCode(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/_/g, "-");
  const m = s.match(/^([A-Z]+)-?0*(\d+)(?:호기?)?$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

const CODE_KEYS = ["code", "equipment", "equip", "device", "machine", "name", "설비", "설비명", "호기", "tag"];
const TIME_KEYS = ["recorded_at", "time", "ts", "timestamp", "datetime", "date_time", "t", "시각", "시간", "일시"];
const VALUE_KEYS = ["current_value", "current", "value", "v", "a", "amp", "ampere", "전류", "전류값"];

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined && obj[real] !== undefined && obj[real] !== null && obj[real] !== "") return obj[real];
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const looksLikeCode = (k: string) => /^[A-Za-z]+[-_ ]?\d+$/.test(k.trim());

/**
 * EMS JSON 을 유연하게 해석한다. 지원 형태:
 *  1) [{code, time, value}, ...]                (레코드 배열)
 *  2) {"PET-1": [{time, value}|[time, value]]}  (설비별 맵, data/readings 하위도 허용)
 *  3) [{time, "PET-1": 61.2, "PET-2": 0}, ...]  (와이드 형식)
 *  4) [{code, readings|data|values: [...]}]      (설비별 객체 배열)
 *  5) {code, start, interval?, values: [n, ...]} (시작 시각 + 1분 간격 배열)
 */
export function parseEmsJson(input: unknown): { points: EmsPoint[]; skipped: number } {
  const points: EmsPoint[] = [];
  let skipped = 0;

  const pushSeries = (code: string, series: unknown, start?: unknown, intervalSec = 60) => {
    if (!Array.isArray(series)) return;
    const st = start != null ? parseKstTimestamp(start) : null;
    series.forEach((p, i) => {
      let ts: Date | null = null;
      let v: number | null = null;
      if (Array.isArray(p)) {
        ts = parseKstTimestamp(p[0]);
        v = toNum(p[1]);
      } else if (p && typeof p === "object") {
        ts = parseKstTimestamp(pick(p as Record<string, unknown>, TIME_KEYS));
        v = toNum(pick(p as Record<string, unknown>, VALUE_KEYS));
      } else if (st) {
        ts = new Date(st.getTime() + i * intervalSec * 1000);
        v = toNum(p);
      }
      if (ts && v != null) points.push({ code: normalizeCode(code), ts, value: v });
      else skipped++;
    });
  };

  const visit = (node: unknown, ctxCode?: string) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          skipped++;
          continue;
        }
        const o = item as Record<string, unknown>;
        const code = pick(o, CODE_KEYS) ?? ctxCode;
        const nested = pick(o, ["readings", "data", "values", "series", "points"]);
        if (code && Array.isArray(nested)) {
          pushSeries(String(code), nested, pick(o, ["start", "start_time", "from"]), toNum(pick(o, ["interval", "interval_sec"])) ?? 60);
          continue;
        }
        const ts = parseKstTimestamp(pick(o, TIME_KEYS));
        const v = toNum(pick(o, VALUE_KEYS));
        if (code && ts && v != null) {
          points.push({ code: normalizeCode(code), ts, value: v });
          continue;
        }
        // 와이드 형식
        if (ts) {
          let any = false;
          for (const [k, val] of Object.entries(o)) {
            const n = toNum(val);
            if (looksLikeCode(k) && n != null) {
              points.push({ code: normalizeCode(k), ts, value: n });
              any = true;
            }
          }
          if (any) continue;
        }
        skipped++;
      }
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const code = pick(o, CODE_KEYS);
      const values = pick(o, ["values", "readings", "series", "points"]);
      if (code && Array.isArray(values)) {
        pushSeries(String(code), values, pick(o, ["start", "start_time", "from"]), toNum(pick(o, ["interval", "interval_sec"])) ?? 60);
        return;
      }
      const keys = Object.keys(o);
      if (keys.some(looksLikeCode)) {
        for (const k of keys) {
          if (looksLikeCode(k)) {
            const val = o[k];
            if (Array.isArray(val)) pushSeries(k, val);
            else if (val && typeof val === "object") visit(val, k);
          }
        }
        return;
      }
      for (const k of ["data", "readings", "records", "items", "rows", "result"]) {
        if (o[k] !== undefined) return visit(o[k], ctxCode);
      }
    }
  };

  visit(input);
  return { points, skipped };
}

export type MoldRow = {
  code: string;
  date: string;
  deptCode: string | null;
  orderNo: string;
  itemName: string | null;
  inputQty: number;
  goodQty: number;
  capa12hr: number;
};

const H = {
  code: ["설비", "설비명", "설비코드", "호기", "기계", "machine", "equipment"],
  date: ["생산일자", "작업일자", "일자", "날짜", "생산일", "date"],
  dept: ["부서코드", "부서", "dept"],
  order: ["작업지시번호", "작업지시", "지시번호", "order"],
  item: ["품명", "품목명", "제품명", "item"],
  input: ["총투입수", "투입수", "총생산수", "생산수량", "input"],
  good: ["양품수", "양품", "양품수량", "good"],
  capa: ["capa'(12hr)", "capa(12hr)", "capa 12hr", "12시간capa", "capa_12hr", "capa", "기준capa"],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s_]/g, "");

function excelDate(v: unknown): string | null {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null;
}

/** MOLD 생산실적 .xls/.xlsx 파싱. 헤더 행은 상위 20행 중에서 자동 탐색. */
export function parseMoldWorkbook(buf: ArrayBuffer, fallbackDate?: string): { rows: MoldRow[]; skipped: number; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const rows: MoldRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true });
    let headerIdx = -1;
    let col: Partial<Record<keyof typeof H, number>> = {};
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const cells = (aoa[i] ?? []).map(norm);
      const found: typeof col = {};
      for (const [key, aliases] of Object.entries(H) as [keyof typeof H, string[]][]) {
        for (const a of aliases) {
          const idx = cells.findIndex((c) => c === norm(a));
          if (idx >= 0) { found[key] = idx; break; }
        }
        if (found[key] === undefined) {
          const idx = cells.findIndex((c) => aliases.some((a) => c.includes(norm(a))));
          if (idx >= 0) found[key] = idx;
        }
      }
      if (found.code !== undefined && (found.input !== undefined || found.good !== undefined)) {
        headerIdx = i;
        col = found;
        break;
      }
    }
    if (headerIdx < 0) {
      warnings.push(`시트 '${name}': 설비/투입수 헤더를 찾지 못해 건너뜀`);
      continue;
    }
    if (col.date === undefined && !fallbackDate) warnings.push(`시트 '${name}': 생산일자 열 없음 — 파일명/선택 날짜 필요`);

    for (const r of aoa.slice(headerIdx + 1)) {
      if (!r || r.every((c) => c == null || c === "")) continue;
      const code = normalizeCode(r[col.code!]);
      const date = (col.date !== undefined ? excelDate(r[col.date]) : null) ?? fallbackDate ?? null;
      if (!code || !date || /합계|소계|total/i.test(String(r[col.code!]))) {
        skipped++;
        continue;
      }
      rows.push({
        code,
        date,
        deptCode: col.dept !== undefined && r[col.dept] != null ? String(r[col.dept]) : null,
        orderNo: col.order !== undefined && r[col.order] != null ? String(r[col.order]) : "-",
        itemName: col.item !== undefined && r[col.item] != null ? String(r[col.item]) : null,
        inputQty: Math.round(toNum(col.input !== undefined ? r[col.input] : 0) ?? 0),
        goodQty: Math.round(toNum(col.good !== undefined ? r[col.good] : 0) ?? 0),
        capa12hr: toNum(col.capa !== undefined ? r[col.capa] : 0) ?? 0,
      });
    }
  }
  return { rows, skipped, warnings };
}

/** 파일명에서 날짜 추출 (예: MOLD_20261013.xls) */
export function dateFromFileName(name: string): string | undefined {
  const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
