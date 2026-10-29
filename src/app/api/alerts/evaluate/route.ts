import { checkCronSecret, handler, isDate, qs } from "@/lib/api";
import { evaluateAlerts } from "@/lib/alerts/evaluate";

export const maxDuration = 30;

// Vercel Cron 은 GET 으로 호출한다 (vercel.json, 5분 주기)
export const GET = handler(async (req, db) => {
  checkCronSecret(req);
  const d = qs(req).get("date");
  return evaluateAlerts(db, isDate(d) ? "analysis" : "cron", isDate(d) ? d : undefined);
});

export const POST = GET;
