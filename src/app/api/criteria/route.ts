import { asc } from "drizzle-orm";
import { handler } from "@/lib/api";
import { criteria } from "@/db/schema";

export const GET = handler(async (_req, db) => db.select().from(criteria).orderBy(asc(criteria.id)));
