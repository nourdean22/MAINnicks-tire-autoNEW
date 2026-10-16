/**
 * scripts/arbiter-judge-split.ts · 2026-10-16 (Brain W1, the retrieval arbiter)
 *
 * The second instrument for promoting NICK_RECALL_ARBITER (the first is the
 * frozen corpus in scripts/recall-eval.ts, absent on some machines): split the
 * judge's reply_judgment composites by whether the arbiter shaped the turn,
 * read from the chat message's persisted contextReceipt.arbiter
 * (lib/ai/context-budget.ts, written by brain-context, persisted in
 * ChatMessage.tokenUsage by persist-assistant-message.ts).
 *
 * READ-ONLY BY CONSTRUCTION: the only Prisma calls are two findMany reads, and
 * tests/brain/arbiter-judge-split-readonly.test.ts scans this file for any
 * write shape. Every worktree binds the production DATABASE_URL.
 *
 * Usage (from apps/statenour):
 *   pnpm exec tsx scripts/arbiter-judge-split.ts            # last 7 days
 *   pnpm exec tsx scripts/arbiter-judge-split.ts --days 14
 *
 * Prints: the window, then one row per arbiter state (true / false / unknown)
 * with n, mean composite and p50 composite. "unknown" = the judge row's message
 * has no persisted receipt, or a receipt from before W1 (no `arbiter` field),
 * or the message row is gone. It is never folded into false.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

type ArbiterState = "true" | "false" | "unknown";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function p50(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The persisted receipt lives at tokenUsage.contextReceipt; absent or pre-W1 = unknown. */
export function arbiterStateOf(tokenUsage: unknown): ArbiterState {
  if (!tokenUsage || typeof tokenUsage !== "object") return "unknown";
  const receipt = (tokenUsage as { contextReceipt?: unknown }).contextReceipt;
  if (!receipt || typeof receipt !== "object") return "unknown";
  const a = (receipt as { arbiter?: unknown }).arbiter;
  return a === true ? "true" : a === false ? "false" : "unknown";
}

async function main(): Promise<void> {
  const days = Number(flag("days") ?? 7);
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`--days must be a positive number, got "${flag("days")}"`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run against an unknown DB.");
    process.exit(1);
  }

  const since = new Date(Date.now() - days * 86_400_000);
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // Scored judge rows only: the "judge_unavailable_<id>" coverage rows carry no composite.
    const judged = await prisma.brainMemory.findMany({
      where: { category: "reply_judgment", deletedAt: null, createdAt: { gte: since }, key: { startsWith: "judge_" } },
      select: { key: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const byMessage = new Map<string, number>();
    for (const row of judged) {
      const meta = (row.metadata ?? {}) as { messageId?: unknown; composite?: unknown };
      const messageId = typeof meta.messageId === "string" ? meta.messageId : row.key.replace(/^judge_/, "");
      if (row.key.startsWith("judge_unavailable_")) continue;
      if (typeof meta.composite !== "number" || !Number.isFinite(meta.composite)) continue;
      if (!byMessage.has(messageId)) byMessage.set(messageId, meta.composite); // newest judgment per message wins
    }

    const messageIds = [...byMessage.keys()];
    const messages = messageIds.length
      ? await prisma.chatMessage.findMany({ where: { id: { in: messageIds } }, select: { id: true, tokenUsage: true } })
      : [];
    const usageById = new Map(messages.map((m) => [m.id, m.tokenUsage]));

    const buckets: Record<ArbiterState, number[]> = { true: [], false: [], unknown: [] };
    for (const [messageId, composite] of byMessage) {
      const state = usageById.has(messageId) ? arbiterStateOf(usageById.get(messageId)) : "unknown";
      buckets[state].push(composite);
    }

    console.log(`arbiter judge-split · window ${days} days (since ${since.toISOString()}) · ${judged.length} judge rows, ${byMessage.size} scored messages, ${messages.length} message rows found`);
    console.log("arbiter   n     mean   p50");
    for (const state of ["true", "false", "unknown"] as const) {
      const xs = [...buckets[state]].sort((a, b) => a - b);
      const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
      console.log(`${state.padEnd(9)} ${String(xs.length).padEnd(5)} ${fmt(mean(xs)).padEnd(6)} ${fmt(p50(xs))}`);
    }
    if (buckets.true.length === 0) {
      console.log("note: no arbiter=true turns in the window — the flag is off or the receipts predate W1; this split cannot judge the arbiter yet.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("arbiter-judge-split failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
