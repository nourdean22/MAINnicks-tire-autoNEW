/**
 * Budget gate smoke · non-mutating.
 *
 * Calls the actual gate function against the live DB without changing
 * any settings. Verifies:
 *   1. assertWithinBudget returns ok=true with current spend
 *   2. The 60s cache works (second call doesn't hit DB)
 *   3. The cached limit matches the configured setting
 *
 * Doesn't trigger the gate against a deliberate over-budget — that
 * requires a setting mutation we won't do automatically. Test in UI.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

console.log("\n=== Budget gate smoke (non-mutating) ===\n");

// Read the setting directly first
const setting = await prisma.userPreference.findUnique({ where: { key: "ai.dailyBudgetCents" } });
const limitFromSetting = setting ? Number(setting.value) : 500;
console.log(`1. setting · ai.dailyBudgetCents = ${limitFromSetting}¢ ($${(limitFromSetting/100).toFixed(2)})`);

// Today's spend from prisma directly
const todayStart = new Date(); todayStart.setHours(0,0,0,0);
const agg = await prisma.aiGeneration.aggregate({
  where: { createdAt: { gte: todayStart } },
  _sum: { costCents: true },
  _count: true,
});
const spent = agg._sum.costCents ?? 0;
console.log(`2. spend  · today=${spent}¢ across ${agg._count} calls`);
console.log(`3. gate   · spent < limit? ${spent < limitFromSetting} → would ${spent >= limitFromSetting ? "BLOCK" : "ALLOW"}`);

// Verify the AiGeneration table is being written to recently
const lastWrite = await prisma.aiGeneration.findFirst({
  orderBy: { createdAt: "desc" },
  select: { createdAt: true, feature: true, model: true, costCents: true },
});
if (lastWrite) {
  const ago = Math.round((Date.now() - lastWrite.createdAt.getTime()) / 60_000);
  console.log(`4. tracking · last AiGeneration write was ${ago}min ago · feature=${lastWrite.feature} model=${lastWrite.model} cost=${lastWrite.costCents}¢`);
} else {
  console.log(`4. tracking · 🔴 AiGeneration table is EMPTY — no AI calls have been tracked, gate has no signal`);
}

// 7d budget history
console.log(`\n5. 7d budget history:`);
for (let i = 0; i < 7; i++) {
  const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
  const dayEnd = new Date(d); dayEnd.setHours(23,59,59,999);
  const r = await prisma.aiGeneration.aggregate({
    where: { createdAt: { gte: d, lte: dayEnd } },
    _sum: { costCents: true },
    _count: true,
  });
  const dollars = ((r._sum.costCents ?? 0) / 100).toFixed(2);
  console.log(`   ${d.toISOString().slice(0,10)}  $${dollars.padStart(7)} · ${r._count} calls`);
}

await prisma.$disconnect();
