import { desc } from "drizzle-orm";
import { handler } from "@/lib/api";
import { uploadLog } from "@/db/schema";

export const GET = handler(async (_req, db) => db.select().from(uploadLog).orderBy(desc(uploadLog.uploadedAt)).limit(50));
