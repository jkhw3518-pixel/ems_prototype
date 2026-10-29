// pnpm db:sql "select ..." — 현재 대상 DB 에 SQL 실행 후 표로 출력 (점검용)
import { sql } from "drizzle-orm";
import { getDb } from "../src/db";

(async () => {
  const db = await getDb();
  const r = await db.execute(sql.raw(process.argv[2]));
  console.table(r.rows);
  process.exit(0);
})();
