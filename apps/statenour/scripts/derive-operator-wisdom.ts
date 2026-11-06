/**
 * Derive wisdom about Nour from his own brain, for Nick's wisdom slots (Nick audit A8, 2026-11-06).
 *
 * Reads the brain's derived rows about Nour (qualitative_identity, blind_spot, pattern, preference,
 * belief, goal, decision/chat patterns, confidence >= 0.6) and his recent journal dumps, makes one
 * reason-lane call per OPERATOR_WISDOM_BATCH rows on the normal provider chain (inside the daily AI
 * budget; one call for the whole pool ran out of output tokens on hidden thinking), keeps only insights
 * whose every cited id is a row it was shown (lib/brain/operator-wisdom.ts), and on --apply writes
 * them through admitMemory as DERIVED memories (lineage, AGENT_INFERRED tier, the wisdom quality
 * gate) under origin nour-brain-derived / source pack:nour-brain-derived, embeds them, and only then
 * retires this script's own earlier rows (writeOperatorWisdom).
 *
 * DRY RUN BY DEFAULT: it reads and calls the model, prints counts only (pool by category, insights
 * by kind, kept vs dropped), and returns before any write. The insight text is never printed: it is
 * personal, and terminal output ends up in PRs and logs.
 *
 * Run: `railway run -s statenour-web -- pnpm exec tsx scripts/derive-operator-wisdom.ts` (dry run, 50 newest rows)
 *      `--limit=N` for a different pool size; add `--apply` to write (a production write: Nour's go).
 */
import Module from "node:module";
import {
  buildOperatorWisdomPrompt,
  chunkPool,
  mergeOperatorInsights,
  OPERATOR_INSIGHT_KINDS,
  OPERATOR_WISDOM_SOURCE,
  operatorWisdomArgs,
  operatorWisdomRows,
  parseOperatorInsights,
  writeOperatorWisdom,
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
  const args = operatorWisdomArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`[!] ${args.error}`);
    process.exit(1);
  }
  const { apply, limit } = args;
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
    select: { id: true, category: true, content: true, lastSeen: true },
  });
  const dumps = await prisma.brainDump.findMany({
    where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - DUMP_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: POOL_DUMP_CAP,
    select: { id: true, summary: true, rawThoughts: true, createdAt: true },
  });
  // Newest first across both sources, then the limit, so journal entries compete on recency with brain rows.
  const pool: PoolItem[] = [
    ...memories.map((m) => ({ id: m.id, category: m.category, content: m.content, at: m.lastSeen })),
    ...dumps.map((d) => ({ id: d.id, category: "journal", content: d.summary || d.rawThoughts, at: d.createdAt })),
  ]
    .filter((p) => p.content && p.content.trim().length > 0)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map(({ id, category, content }) => ({ id, category, content }));

  const byCategory = new Map<string, number>();
  for (const p of pool) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  console.log(`pool ${pool.length}: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (pool.length === 0) {
    console.error("[!] empty pool: nothing to derive from (not 'no insights')");
    process.exit(1);
  }

  // One call per batch: a thinking model spends the lane's output cap on hidden reasoning in proportion to the
  // rows it reads, so the whole pool in one call came back cut off or empty (OPERATOR_WISDOM_BATCH, 2026-11-06).
  const batches = chunkPool(pool);
  const keptBatches: Parameters<typeof mergeOperatorInsights>[0] = [];
  let dropped = 0;
  let noAnswer = 0;
  let noJson = 0;
  let modelId = "";
  for (const [i, batch] of batches.entries()) {
    const { system, user } = buildOperatorWisdomPrompt(batch);
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
      console.error(`[!] batch ${i + 1}/${batches.length}: no model answered (provider ${reply.provider}; ${why || "no failure detail"})`);
      noAnswer += 1;
      continue;
    }
    modelId = reply.model;
    const parsed = parseOperatorInsights(reply.content, new Set(batch.map((p) => p.id)));
    if (parsed.parseError) {
      console.error(`[!] batch ${i + 1}/${batches.length}: the reply held no insights JSON (provider ${reply.provider}, ${reply.content.length} chars)`);
      noJson += 1;
      continue;
    }
    keptBatches.push(parsed.kept.map((k) => ({ ...k, model: reply.model })));
    dropped += parsed.dropped;
    console.log(`batch ${i + 1}/${batches.length}: ${batch.length} rows, kept ${parsed.kept.length}, dropped ${parsed.dropped}`);
  }
  if (keptBatches.length === 0) {
    console.error(`[!] no batch yielded insights (${noAnswer} unanswered, ${noJson} without JSON of ${batches.length}); nothing derived, nothing written`);
    process.exit(1);
  }
  const kept = mergeOperatorInsights(keptBatches);
  const perKind = OPERATOR_INSIGHT_KINDS.map((k) => `${k} ${kept.filter((i) => i.kind === k).length}`);
  console.log(
    `insights kept ${kept.length} from ${keptBatches.length}/${batches.length} batches (${noAnswer} unanswered, ${noJson} without JSON), ` +
      `dropped ${dropped} (ungrounded or malformed): ${perKind.join(", ")}`,
  );

  if (!apply) {
    console.log("[dry-run] no write. Re-run with --apply to write these as wisdom rows.");
    return;
  }
  if (kept.length === 0) {
    console.error("[!] zero grounded insights: refusing to retire the existing set");
    process.exit(1);
  }
  // The write retires every earlier row the new set no longer holds, so a partial derivation (a batch that did
  // not answer) would retire insights that batch would have re-derived. All batches or no write.
  if (noAnswer + noJson > 0) {
    console.error(`[!] ${noAnswer + noJson} of ${batches.length} batches failed: refusing to write from a partial derivation`);
    process.exit(1);
  }

  const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
  const { admitMemory } = await import("@/lib/brain/memory-admission");
  const { computeExpiresAt } = await import("@/lib/brain/category-ttl");
  const { embedLoadedRows, embedSummary } = await import("./_lib/embed-loaded-rows");
  const out = await writeOperatorWisdom(operatorWisdomRows(kept, now.toISOString()), {
    admit: (input) => admitMemory(input as unknown as Parameters<typeof admitMemory>[0]),
    categoryOf: async (id) => (await prisma.brainMemory.findUnique({ where: { id }, select: { category: true } }))?.category ?? null,
    // remember() stamps a new row with a 24 h probation; wisdom's category policy (category-ttl) is keep forever.
    // deletedAt: null revives a row an earlier run retired whose text came back.
    keepForever: async (ids) => {
      if (ids.length === 0) return;
      await prisma.brainMemory.updateMany({
        where: { id: { in: ids } },
        data: { expiresAt: computeExpiresAt(BRAIN_CATEGORIES.WISDOM), deletedAt: null },
      });
    },
    embed: (ids) => embedLoadedRows(ids),
    // A refresh, not an append: this script's own rows the new set no longer holds.
    retire: async (keepKeys) =>
      (
        await prisma.brainMemory.updateMany({
          where: { category: BRAIN_CATEGORIES.WISDOM, source: OPERATOR_WISDOM_SOURCE, deletedAt: null, key: { notIn: keepKeys } },
          data: { deletedAt: now },
        })
      ).count,
    memoryIds: new Set(memories.map((m) => m.id)),
    modelId,
  });
  console.log(
    `[ok] wisdom ${out.wisdom}, parked by the quality gate ${out.candidates}, ${embedSummary(out.embedded)}, ` +
      (out.kept ? `retired ${out.retired} older` : "previous set KEPT (nothing new reached wisdom, or a row did not embed)"),
  );
  if (!out.kept) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[!] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
