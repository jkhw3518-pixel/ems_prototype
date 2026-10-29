// pnpm db:import-remote — SOURCE_DATABASE_URL 의 ems_reading / ems_mold_production 을 (읽기 전용으로) 가져와
// 현재 대상 DB(DATABASE_URL 또는 로컬 PGlite)에 저장하고 분석까지 실행한다.
import { Client } from "pg";
import { getDb } from "../src/db";
import { analyzeAndAlert, ingestEms, ingestMold } from "../src/lib/ingest";

async function main() {
  const src = process.env.SOURCE_DATABASE_URL;
  if (!src) throw new Error("SOURCE_DATABASE_URL 환경변수가 필요합니다");
  if (src === process.env.DATABASE_URL) throw new Error("원본과 대상 DB 가 같습니다");
  const u = new URL(src);
  const ssl = u.searchParams.get("sslmode") === "require";
  u.searchParams.delete("sslmode");
  const client = new Client({ connectionString: u.toString(), ssl: ssl ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");

  const db = await getDb();
  const r = await client.query<{ code: string; ts: Date; value: string }>(
    `select e.code, r.recorded_at as ts, r.current_value as value from ems_reading r join ems_equipment e on e.id = r.equipment_id`,
  );
  console.log(`▶ 리딩 ${r.rowCount}건 읽음`);
  const ems = await ingestEms(db, r.rows.map((x) => ({ code: x.code, ts: new Date(x.ts), value: Number(x.value) })));
  console.log(`✔ 저장 ${ems.saved}건, 분석일 ${ems.dates.join(", ")}`);

  const m = await client.query(
    `select e.code, m.production_date::text as date, m.dept_code, m.order_no, m.item_name, m.input_qty, m.good_qty, m.capa_12hr
     from ems_mold_production m join ems_equipment e on e.id = m.equipment_id`,
  );
  if (m.rowCount) {
    const mold = await ingestMold(
      db,
      m.rows.map((x) => ({
        code: x.code, date: x.date, deptCode: x.dept_code, orderNo: x.order_no ?? "-", itemName: x.item_name,
        inputQty: x.input_qty, goodQty: x.good_qty, capa12hr: Number(x.capa_12hr ?? 0),
      })),
    );
    console.log(`✔ MOLD ${mold.saved}건`);
  }
  await client.end();

  const res = await analyzeAndAlert(db, ems.dates, { alerts: true });
  for (const x of res) console.log(`  ${x.date}: 분석 ${x.analyzed}대 / 가동 ${x.running} / 제외 ${x.excluded} / 구간 ${x.events}${x.error ? ` ✖ ${x.error}` : ""}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
