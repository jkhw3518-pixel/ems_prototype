import { asc } from "drizzle-orm";
import { body, handler, HttpError } from "@/lib/api";
import { downtimeCause } from "@/db/schema";

/** 원인 마스터 (대분류별 그룹) */
export const GET = handler(async (_req, db) => {
  const list = await db.select().from(downtimeCause).orderBy(asc(downtimeCause.displayOrder));
  const cats = new Map<string, { category: string; categoryName: string; color: string; isPlanned: boolean; causes: typeof list }>();
  for (const c of list) {
    let g = cats.get(c.category);
    if (!g) cats.set(c.category, (g = { category: c.category, categoryName: c.categoryName, color: c.color, isPlanned: c.isPlanned, causes: [] }));
    g.causes.push(c);
  }
  return { categories: [...cats.values()], causes: list };
});

export const POST = handler(async (req, db) => {
  const b = await body<{ code: string; category: string; name: string; isPlanned?: boolean; color?: string }>(req);
  const code = (b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new HttpError(400, "코드는 영문 대문자/숫자/_ 2~20자");
  if (!b.name?.trim()) throw new HttpError(400, "원인명이 필요합니다");
  const all = await db.select().from(downtimeCause);
  const sibling = all.filter((c) => c.category === b.category);
  if (!sibling.length) throw new HttpError(400, "존재하지 않는 대분류입니다");
  const [row] = await db
    .insert(downtimeCause)
    .values({
      code,
      category: b.category,
      categoryName: sibling[0].categoryName,
      name: b.name.trim(),
      isPlanned: b.isPlanned ?? sibling[0].isPlanned,
      color: b.color ?? sibling[0].color,
      displayOrder: Math.max(...sibling.map((s) => s.displayOrder)) + 1,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new HttpError(409, "이미 존재하는 코드입니다");
  return row;
});
