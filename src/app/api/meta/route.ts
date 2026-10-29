import { sql } from "drizzle-orm";
import { handler } from "@/lib/api";
import { analysisDates, rows } from "@/lib/queries/common";

/** 헤더/공통 UI 용: 분석일 목록, 미확인 알림 수 */
export const GET = handler(async (_req, db) => {
  const [{ n }] = await rows<{ n: number }>(db, sql`select count(*)::int as n from ems_alert_log where acknowledged_at is null`);
  return { dates: await analysisDates(db), unackedAlerts: n, dbMode: process.env.DATABASE_URL ? "postgres" : "pglite" };
});
