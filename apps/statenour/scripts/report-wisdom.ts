/**
 * v10.0.354 · Snapshot of Nick's wisdom · brain memories with
 * category="wisdom" · what's loaded, where it came from, recency,
 * confidence distribution, and how often each one fires.
 *
 * Run: pnpm tsx scripts/report-wisdom.ts
 */

import { prisma } from "@/lib/prisma";

interface WisdomRow {
  id: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  createdBy: string | null;
  createdAt: Date;
  lastSeen: Date;
  seenCount: number;
  metadata: unknown;
}

function fmtAge(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = ms / 86400_000;
  if (days < 1) {
    const hrs = ms / 3600_000;
    return hrs < 1 ? `${Math.round(ms / 60_000)}m ago` : `${Math.round(hrs)}h ago`;
  }
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function bar(n: number, max: number, width = 20): string {
  if (max === 0) return "·".repeat(width);
  const filled = Math.round((n / max) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

async function main() {
  const wisdoms = (await prisma.brainMemory.findMany({
    where: { category: "wisdom" },
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      source: true,
      createdBy: true,
      createdAt: true,
      lastSeen: true,
      seenCount: true,
      metadata: true,
    },
    orderBy: [{ seenCount: "desc" }, { createdAt: "desc" }],
  })) as WisdomRow[];

  const total = wisdoms.length;

  // ── 1 · Top-line ──
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  NICK'S WISDOM · brain memory snapshot");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Total wisdom memories: ${total}`);
  if (total === 0) {
    console.log("  (none yet · run scripts/ingest-wisdom-skills.ts to seed)");
    await prisma.$disconnect();
    return;
  }

  // ── 2 · By origin (from metadata.origin) ──
  const byOrigin: Record<string, number> = {};
  for (const w of wisdoms) {
    const meta = w.metadata as { origin?: string } | null;
    const origin = meta?.origin ?? "uncategorized";
    byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;
  }
  console.log("");
  console.log("  By origin:");
  for (const [origin, count] of Object.entries(byOrigin).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${origin.padEnd(20)} ${String(count).padStart(3)}  ${bar(count, total)}`);
  }

  // ── 3 · By source (manual / skill_ingestion / consolidation / etc) ──
  const bySource: Record<string, number> = {};
  for (const w of wisdoms) {
    bySource[w.source] = (bySource[w.source] ?? 0) + 1;
  }
  console.log("");
  console.log("  By source:");
  for (const [src, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(20)} ${String(count).padStart(3)}  ${bar(count, total)}`);
  }

  // ── 4 · Confidence distribution ──
  let sumConf = 0;
  let conf100 = 0;
  let conf75 = 0;
  let confLow = 0;
  for (const w of wisdoms) {
    sumConf += w.confidence;
    if (w.confidence >= 1.0) conf100++;
    else if (w.confidence >= 0.75) conf75++;
    else confLow++;
  }
  console.log("");
  console.log("  Confidence:");
  console.log(`    avg                   ${(sumConf / total).toFixed(2)}`);
  console.log(`    full (1.0)            ${String(conf100).padStart(3)}  ${bar(conf100, total)}`);
  console.log(`    high (0.75 - 0.99)    ${String(conf75).padStart(3)}  ${bar(conf75, total)}`);
  console.log(`    < 0.75                ${String(confLow).padStart(3)}  ${bar(confLow, total)}`);

  // ── 5 · Recall heat ──
  const totalSeen = wisdoms.reduce((s, w) => s + w.seenCount, 0);
  const everSeen = wisdoms.filter((w) => w.seenCount > 1).length;
  const neverSeen = wisdoms.filter((w) => w.seenCount <= 1).length;
  console.log("");
  console.log("  Recall heat (seenCount):");
  console.log(`    total recalls:        ${totalSeen}`);
  console.log(`    fired ≥ 2x:           ${everSeen}`);
  console.log(`    cold (1x · seed only) ${neverSeen}`);

  // ── 6 · Top 5 most-recalled ──
  const topRecalled = [...wisdoms]
    .sort((a, b) => b.seenCount - a.seenCount)
    .slice(0, 5);
  console.log("");
  console.log("  Top 5 most-recalled:");
  for (const w of topRecalled) {
    const preview = w.content.slice(0, 60).replace(/\n/g, " ");
    console.log(
      `    ${String(w.seenCount).padStart(4)}x  ${w.key.padEnd(38)}  ${preview}…`,
    );
  }

  // ── 7 · 5 most recent (when last seen) ──
  const mostRecent = [...wisdoms]
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
    .slice(0, 5);
  console.log("");
  console.log("  Most recently surfaced:");
  for (const w of mostRecent) {
    console.log(`    ${fmtAge(w.lastSeen).padEnd(10)}  ${w.key}`);
  }

  // ── 8 · Full list grouped by origin ──
  console.log("");
  console.log("  ──── FULL CATALOG ────");
  const byOriginList: Record<string, WisdomRow[]> = {};
  for (const w of wisdoms) {
    const meta = w.metadata as { origin?: string } | null;
    const origin = meta?.origin ?? "uncategorized";
    (byOriginList[origin] ??= []).push(w);
  }
  for (const [origin, list] of Object.entries(byOriginList).sort()) {
    console.log("");
    console.log(`  ── ${origin.toUpperCase()} (${list.length}) ──`);
    for (const w of list.sort((a, b) => a.key.localeCompare(b.key))) {
      const preview = w.content.slice(0, 90).replace(/\n/g, " ");
      console.log(`    · ${w.key}`);
      console.log(`        ${preview}…`);
    }
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Wisdom report failed:", err);
  process.exit(1);
});
