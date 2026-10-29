import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { MIGRATION_SQL, V1_CAUSE_MIGRATION_SQL } from "./migrations";
import { ALERT_RULE_SEED, CAUSE_SEED, CRITERIA_SEED, EQUIPMENT_SEED } from "@/lib/constants";

// DATABASE_URL 이 있으면 PostgreSQL, 없으면 로컬 PGlite(.pglite/) 로 동작한다.
export type DB = NodePgDatabase<typeof schema>;

type Holder = { db?: Promise<DB> };
const g = globalThis as unknown as { __emsDb?: Holder };
g.__emsDb ??= {};

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const u = new URL(url);
    const needSsl = u.searchParams.get("sslmode") === "require";
    u.searchParams.delete("sslmode");
    const pool = new Pool({
      connectionString: u.toString(),
      ssl: needSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
    return drizzlePg(pool, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(db);
  await seed(db);
  return db;
}

export function getDb(): Promise<DB> {
  g.__emsDb!.db ??= create().catch((e) => {
    g.__emsDb!.db = undefined;
    throw e;
  });
  return g.__emsDb!.db;
}

export async function migrate(db: DB) {
  // PGlite/pg 모두 다중 statement 를 한 번에 실행할 수 있도록 분리 실행
  for (const stmt of MIGRATION_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
}

export async function seed(db: DB) {
  for (const e of EQUIPMENT_SEED) {
    await db
      .insert(schema.equipment)
      .values({ code: e.code, factory: e.factory, group: e.group, displayOrder: e.order })
      .onConflictDoNothing();
  }
  for (const c of CRITERIA_SEED) {
    await db
      .insert(schema.criteria)
      .values({ group: c.group, stopThreshold: c.stop, idleThreshold: c.idle, durationMin: c.duration })
      .onConflictDoNothing();
  }
  for (const c of CAUSE_SEED) {
    await db.insert(schema.downtimeCause).values(c).onConflictDoNothing();
  }
  await db.execute(sql.raw(V1_CAUSE_MIGRATION_SQL));

  const [{ n }] = (await db.execute(sql`select count(*)::int as n from ems_alert_rule`)).rows as { n: number }[];
  if (n === 0) {
    for (const r of ALERT_RULE_SEED) {
      await db.insert(schema.alertRule).values({
        name: r.name,
        ruleType: r.ruleType,
        scopeType: "all",
        threshold: r.threshold,
        period: r.period,
        severity: r.severity,
        cooldownMin: 60,
      });
    }
  }
}

export { schema };
