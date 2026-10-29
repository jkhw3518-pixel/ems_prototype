// pnpm db:migrate — DATABASE_URL 대상(없으면 로컬 PGlite)에 스키마 + 기본 시드 적용 (멱등)
import { getDb, migrate, seed } from "../src/db";

async function main() {
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : `PGlite (${process.env.PGLITE_DIR ?? "./.pglite"})`;
  console.log(`▶ 마이그레이션 대상: ${target}`);
  const db = await getDb();
  await migrate(db);
  await seed(db);
  console.log("✔ 스키마/시드 적용 완료 (설비 37 · 판정기준 11 · 원인 30 · 기본 알림 규칙 6)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
