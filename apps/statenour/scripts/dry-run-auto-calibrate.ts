#!/usr/bin/env tsx
/**
 * dry-run-auto-calibrate.ts
 *
 * Runs the auto-calibrate logic against prod Neon but WITHOUT
 * applying the mutations. Shows exactly what would change if the
 * nightly cron fired right now. First real confidence check that
 * the rule-based triage does what we intend.
 *
 * Ships the same classification logic as
 * /api/cron/auto-calibrate/route.ts but every prisma.update /
 * create call is replaced with a console.log so Nour can eyeball
 * the diff before trusting the live cron at 2:30am.
 *
 * Run:
 *   npx tsx scripts/dry-run-auto-calibrate.ts
 *   (add --apply to actually write — don't, unless you know)
 */
import { loadEnv, confirmDatabase } from "./_lib/safety";

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const skipConfirm = process.argv.includes("--yes") || !!process.env.CI;
  if (!skipConfirm) {
    await confirmDatabase(apply ? "auto-calibrate APPLY" : "auto-calibrate dry-run");
  }

  const { prisma } = await import("@/lib/prisma");
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

  const CALIBRATABLE_CATEGORIES = [
    "pattern",
    "insight",
    "preference",
    "feedback",
    "wisdom",
    "rule",
    "routine",
  ];

  const now = new Date();

  const candidates = await prisma.brainMemory.findMany({
    where: {
      category: { in: CALIBRATABLE_CATEGORIES },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      createdAt: { lte: daysAgo(30) },
    },
    orderBy: [{ lastSeen: "asc" }, { confidence: "desc" }],
    take: 20,
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      confidence: true,
      seenCount: true,
      lastSeen: true,
      createdAt: true,
    },
  });

  const recentContradictions = await prisma.brainMemory.findMany({
    where: {
      category: "contradiction",
      createdAt: { gte: daysAgo(14) },
    },
    select: { content: true },
  });
  const contradictionText = recentContradictions
    .map((c) => c.content.toLowerCase())
    .join(" ");

  console.log("─".repeat(70));
  console.log(`AUTO-CALIBRATE DRY RUN — ${now.toISOString()}`);
  console.log("─".repeat(70));
  console.log(`candidates: ${candidates.length}`);
  console.log(`recent contradictions (last 14d): ${recentContradictions.length}`);
  console.log(`mode: ${apply ? "APPLY (writes enabled)" : "DRY (no writes)"}`);
  console.log("─".repeat(70));

  let verified = 0;
  let queued = 0;
  let retired = 0;
  let untouched = 0;

  for (const c of candidates) {
    const ageDays = Math.floor((now.getTime() - c.createdAt.getTime()) / 86400_000);
    const sinceSeenDays = Math.floor((now.getTime() - c.lastSeen.getTime()) / 86400_000);
    const keyWords = c.content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 8);
    const hasContradiction = keyWords.some((w) => contradictionText.includes(w));

    const preview = c.content.slice(0, 60).replace(/\s+/g, " ");
    const prefix = `[${c.category}] ${c.key.slice(0, 24)}  conf=${c.confidence.toFixed(2)} age=${ageDays}d seen=${c.seenCount}`;

    if (ageDays > 60 && c.confidence < 0.55 && sinceSeenDays > 45) {
      retired++;
      console.log(`🗑️  RETIRE   ${prefix}`);
      console.log(`           ${preview}`);
      if (apply) {
        await prisma.brainMemory.update({
          where: { id: c.id },
          data: { expiresAt: now },
        });
      }
      continue;
    }
    if (hasContradiction) {
      queued++;
      console.log(`⚠️  REVIEW   ${prefix}`);
      console.log(`           ${preview}`);
      if (apply) {
        await prisma.brainMemory.update({
          where: { id: c.id },
          data: {
            metadata: {
              flag: "needs_review",
              flaggedBy: "auto-calibrate",
              flaggedAt: now.toISOString(),
            } as any,
          },
        });
      }
      continue;
    }
    if (c.confidence >= 0.7 && ageDays >= 30 && verified < 5) {
      verified++;
      const newConf = Math.min(1, c.confidence + 0.05);
      console.log(`✓  VERIFY   ${prefix}  →  conf=${newConf.toFixed(2)}`);
      if (apply) {
        await prisma.brainMemory.update({
          where: { id: c.id },
          data: {
            confidence: newConf,
            seenCount: c.seenCount + 1,
            lastSeen: now,
          },
        });
      }
      continue;
    }
    untouched++;
  }

  console.log("─".repeat(70));
  console.log(
    `SUMMARY: verified=${verified}  queued_for_review=${queued}  retired=${retired}  untouched=${untouched}`
  );
  console.log("─".repeat(70));

  if (!apply && (verified + queued + retired > 0)) {
    console.log("\n(dry-run only — pass --apply to actually write, or let the cron do it at 2:30am ET)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("dry-run-auto-calibrate failed:", err);
  process.exit(1);
});
