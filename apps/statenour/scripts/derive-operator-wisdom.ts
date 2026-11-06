/**
 * Derive wisdom about Nour from his own brain, for Nick's wisdom slots (Nick audit A8, 2026-11-06).
 *
 * Reads the brain's derived rows about Nour (qualitative_identity, blind_spot, pattern, preference,
 * belief, goal, decision/chat patterns, confidence >= 0.6) and his recent journal dumps, makes ONE
 * reason-lane call on the normal provider chain (inside the daily AI budget), keeps only insights
 * whose every cited id is a row it was shown (lib/brain/operator-wisdom.ts), and on --apply writes
 * them as curated wisdom rows (origin nour-brain-derived, source pack:nour-brain-derived), retires
 * this script's own earlier rows that the new set no longer holds, and embeds the new rows.
 *
 * DRY RUN BY DEFAULT: it reads and calls the model, prints counts only (pool by category, insights
 * by kind, kept vs dropped), and returns before any write. The insight text is never printed: it is
 * personal, and terminal output ends up in PRs and logs.
 *
 * Run: `railway run -s statenour-web -- pnpm exec tsx scripts/derive-operator-wisdom.ts` (dry run)
 *      add `--apply` to write (a production write: Nour's go).
 */
import Module from "node:module";
import {
  buildOperatorWisdomPrompt,
  OPERATOR_INSIGHT_KINDS,
  OPERATOR_WISDOM_SOURCE,
  operatorWisdomRows,
  parseOperatorInsights,
  type PoolItem,
} from "@/lib/brain/operator-wisdom";

// Same shim as scripts/backfill-journal-person-ids.ts: lib/ai/provider imports "server-only".
{
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

const SOURCE_CATEGORIES = [
  "qualitative_identity",
  "blind_spot",
  "pattern",
  "preference",
  "belief",
  "goal",
  "decision_pattern",
  "chat_pattern",
];
const MIN_CONFIDENCE = 0.6;
const POOL_MEMORY_CAP = 200;
const POOL_DUMP_CAP = 40;
const DUMP_DAYS = 60;

async function main() {
  const apply = process.argv.includes("--apply");
  // --limit N: a smaller pool (the reason lane returned empty on the full 177-row pool, 2026-11-06).
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 0) : Infinity;
  const { prisma } = await import("@/lib/prisma");
  const { aiChat } = await import("@/lib/ai/provider");
  const now = new Date();

  const memories = await prisma.brainMemory.findMany({
    where: {
      category: { in: SOURCE_CATEGORIES },
      deletedAt: null,
      confidence: { gte: MIN_CONFIDENCE },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { lastSeen: "desc" },
    take: POOL_MEMORY_CAP,
    select: { id: true, category: true, content: true },
  });
  const dumps = await prisma.brainDump.findMany({
    where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - DUMP_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: POOL_DUMP_CAP,
    select: { id: true, summary: true, rawThoughts: true },
  });
  const pool: PoolItem[] = [
    ...memories,
    ...dumps.map((d) => ({ id: d.id, category: "journal", content: d.summary || d.rawThoughts })),
  ].filter((p) => p.content && p.content.trim().length > 0).slice(0, limit);

  const byCategory = new Map<string, number>();
  for (const p of pool) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  console.log(`pool ${pool.length}: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (pool.length === 0) {
    console.error("[!] empty pool: nothing to derive from (not 'no insights')");
    process.exit(1);
  }

  const { system, user } = buildOperatorWisdomPrompt(pool);
  const reply = await aiChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    "reason",
    { telemetry: { functionId: "operator-wisdom" }, timeoutMs: 180_000 },
  );
  if (reply.provider === "none" || reply.provider === "emergency") {
    const why = (reply.failures ?? []).map((f) => `${f.provider}:${f.failureClass ?? "?"}:${f.message.slice(0, 80)}`).join(", ");
    console.error(`[!] no model answered (provider ${reply.provider}; ${why || "no failure detail"}); nothing derived, nothing written`);
    process.exit(1);
  }

  const parsed = parseOperatorInsights(reply.content, new Set(pool.map((p) => p.id)));
  if (parsed.parseError) {
    console.error(`[!] the reply held no insights JSON (provider ${reply.provider}); nothing written`);
    process.exit(1);
  }
  const perKind = OPERATOR_INSIGHT_KINDS.map((k) => `${k} ${parsed.kept.filter((i) => i.kind === k).length}`);
  console.log(`insights kept ${parsed.kept.length}, dropped ${parsed.dropped} (ungrounded or malformed): ${perKind.join(", ")}`);

  if (!apply) {
    console.log("[dry-run] no write. Re-run with --apply to write these as wisdom rows.");
    return;
  }
  if (parsed.kept.length === 0) {
    console.error("[!] zero grounded insights: refusing to retire the existing set");
    process.exit(1);
  }

  const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
  const rows = operatorWisdomRows(parsed.kept, now.toISOString());
  const written: string[] = [];
  for (const r of rows) {
    const saved = await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.WISDOM, key: r.key } },
      create: { category: BRAIN_CATEGORIES.WISDOM, key: r.key, content: r.content, confidence: r.confidence, source: r.source, metadata: r.metadata },
      update: { content: r.content, confidence: r.confidence, source: r.source, metadata: r.metadata, deletedAt: null },
      select: { id: true },
    });
    written.push(saved.id);
  }
  // A refresh, not an append: this script's own rows the new set no longer holds are retired.
  const retired = await prisma.brainMemory.updateMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      source: OPERATOR_WISDOM_SOURCE,
      deletedAt: null,
      key: { notIn: rows.map((r) => r.key) },
    },
    data: { deletedAt: now },
  });
  const { embedLoadedRows, embedSummary } = await import("./_lib/embed-loaded-rows");
  console.log(`[ok] wrote ${written.length}, retired ${retired.count} older, ${embedSummary(await embedLoadedRows(written))}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[!] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
