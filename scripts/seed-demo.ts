// pnpm db:seed-demo [일수=56] — 화면 확인용 가상 데이터 생성 (EMS 1분 전류 + MOLD 실적 + 일부 원인 분류)
// 실제 운영 DB 에는 실행하지 마세요. DATABASE_URL 이 설정되어 있으면 중단합니다.
import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { CRITERIA_SEED, EQUIPMENT_SEED } from "../src/lib/constants";
import { analyzeAndAlert, ingestEms, ingestMold } from "../src/lib/ingest";
import { classifyEvents } from "../src/lib/classify-events";
import { addDays, dayStart, todayKst } from "../src/lib/time";
import type { EmsPoint, MoldRow } from "../src/lib/parsers";

let seed = 20261029;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;

const CAPA: Record<string, number> = { PET: 9000, PE: 6000, 사출기: 4200, "B-1": 2600, "B-2": 2400 };
const OFTEN_OFF = new Set(["PET-10", "PET-11", "PET-12", "PET-15", "P-5"]);
const DECLINING = new Set(["PET-3", "S-2"]); // 최근 악화 추세
const IMPROVING = new Set(["PET-7", "P-2"]);

async function main() {
  if (process.env.DATABASE_URL && process.env.FORCE_DEMO !== "true") {
    throw new Error("DATABASE_URL 이 설정되어 있습니다. 데모 데이터는 로컬 PGlite 에서만 생성하세요 (강제: FORCE_DEMO=true)");
  }
  const days = Number(process.argv[2] ?? 56);
  const last = addDays(todayKst(), -1);
  const first = addDays(last, -(days - 1));
  const db = await getDb();
  const crit = new Map(CRITERIA_SEED.map((c) => [c.group, c]));

  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(addDays(first, i));

  for (const [di, date] of dates.entries()) {
    const points: EmsPoint[] = [];
    const mold: MoldRow[] = [];
    const start = dayStart(date).getTime();
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    // 공장 공통 정전 이벤트 (드물게)
    const utility = chance(0.05) ? { factory: chance(0.5) ? "1공장" : "2공장", at: int(200, 1100), len: int(20, 70) } : null;

    for (const e of EQUIPMENT_SEED) {
      const c = crit.get(e.group)!;
      const off = (OFTEN_OFF.has(e.code) && chance(0.8)) || (weekday === 0 && chance(0.35)) || chance(0.04);
      const states: ("run" | "idle" | "stop")[] = new Array(1440).fill("run");
      const put = (s: number, len: number, st: "idle" | "stop") => {
        for (let i = Math.max(0, s); i < Math.min(1440, s + len); i++) states[i] = st;
      };
      if (off) states.fill("stop");
      else {
        const trend = DECLINING.has(e.code) ? di / days : IMPROVING.has(e.code) ? 1 - di / days : 0.3;
        if (chance(0.55)) put(0, int(10, 50), "stop"); // 가동 준비
        if (chance(0.25)) put(1440 - int(20, 120), 200, "stop"); // 생산 종료
        const breakdowns = int(0, 1 + Math.round(trend * 2));
        for (let k = 0; k < breakdowns; k++) put(int(60, 1300), int(15, 40 + trend * 120), chance(0.7) ? "stop" : "idle");
        if (chance(0.3)) put(int(100, 1200), int(30, 160), "stop"); // 금형 교체
        if (chance(0.5)) put(720 + int(-20, 15), int(8, 25), "idle"); // 교대
        if (chance(0.15 + trend * 0.3)) {
          const at = int(100, 1200);
          for (let k = 0; k < int(3, 6); k++) put(at + k * int(8, 18), int(c.duration, c.duration + 6), "idle"); // 쇼트 스톱
        }
        if (utility && utility.factory === e.factory) put(utility.at, utility.len, "stop");
      }
      const runBase = c.idle * between(1.35, 1.8);
      for (let m = 0; m < 1440; m++) {
        if (chance(0.002)) continue; // 결측
        const s = states[m];
        const v = s === "stop" ? between(0, c.stop * 0.8) : s === "idle" ? between(c.stop + 2, c.idle * 0.9) : runBase * between(0.9, 1.1);
        points.push({ code: e.code, ts: new Date(start + m * 60_000), value: Math.round(v * 10) / 10 });
      }
      const run = states.filter((s) => s === "run").length;
      if (!off && run > 60 && chance(0.93)) {
        const capa = CAPA[e.group] ?? 3200;
        const input = Math.round((run / 720) * capa * between(0.86, 0.98));
        const defect = chance(0.08) ? between(0.05, 0.08) : between(0.004, 0.035);
        mold.push({
          code: e.code, date, deptCode: e.factory === "1공장" ? "1211" : "1212", orderNo: `WO${date.replace(/-/g, "")}-${e.code}`,
          itemName: `${e.group} 제품`, inputQty: input, goodQty: Math.round(input * (1 - defect)), capa12hr: capa,
        });
      }
    }
    await ingestEms(db, points);
    await ingestMold(db, mold);
    // 알림은 최근 3일만 평가 (과거 데이터로 알림이 폭주하지 않도록)
    const [r] = await analyzeAndAlert(db, [date], { alerts: di >= days - 3 });
    process.stdout.write(`\r  ${date}  가동 ${r.running}대 · 제외 ${r.excluded}대 · 구간 ${r.events}개   `);
  }
  console.log();

  // 최근 5일을 제외한 구간은 현장에서 분류했다고 가정 (분류율 ~85%)
  const evs = (
    await db.execute(sql`select id::int as id, suggested_cause_code as s, duration, state from ems_downtime_event
                         where analysis_date < ${addDays(last, -4)} and cause_code is null`)
  ).rows as { id: number; s: string | null; duration: number; state: string }[];
  const pool = ["BRK_MECH", "BRK_ELEC", "BRK_HYD", "BRK_HEAT", "MAT_RESIN", "MAT_DRY", "QLT_ADJ", "CHG_ORDER", "CHG_COLOR", "MOLD_REPAIR", "PLN_PM", "PLN_BREAK"];
  const byCode = new Map<string, number[]>();
  for (const e of evs) {
    if (!chance(0.85)) continue;
    const code = e.s && chance(0.8) ? e.s : e.state === "idle" && e.duration < 30 ? "PLN_BREAK" : pool[int(0, pool.length - 1)];
    byCode.set(code, [...(byCode.get(code) ?? []), e.id]);
  }
  for (const [code, ids] of byCode) await classifyEvents(db, ids, { causeCode: code, by: "데모", source: "bulk" });
  console.log(`✔ 데모 데이터 ${first} ~ ${last} (${days}일) 생성 완료, 분류 ${[...byCode.values()].flat().length}건`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
