import { body, handler, requireDate } from "@/lib/api";
import { analyzeAndAlert } from "@/lib/ingest";
import { datesWithReadings } from "@/lib/engine/analyze";

export const maxDuration = 60;

/** body: { date } 또는 { all: true } (리딩이 있는 모든 날) */
export const POST = handler(async (req, db) => {
  const b = await body<{ date?: string; all?: boolean; alerts?: boolean }>(req);
  const dates = b.all ? await datesWithReadings(db) : [requireDate(b.date)];
  return { results: await analyzeAndAlert(db, dates, { alerts: b.alerts }) };
});
