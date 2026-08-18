/**
 * scripts/backfill-persona-judgments.ts — persona-axis backfill (2026-08-18).
 *
 * Operator-ordered: re-judge recent chat replies with the 8-axis judge
 * (#1649) so the persona census and harvest flywheel have data NOW
 * instead of waiting weeks for organic traffic.
 *
 * Persist shapes are decided by the PURE, typechecked planner in
 * lib/ai/judge-eval/backfill.ts — read its history-preservation rule
 * before changing anything here. Summary: never-judged messages get a
 * full 8-axis `judge_<id>` row; already-judged messages get a
 * persona-only `judge_bf_<id>` companion so the original row's lane,
 * scores, and composite stay untouched.
 *
 * Writes go through DIRECT prisma upsert, NOT brainMemory.remember():
 * remember() hardcodes a 24h expiry on create and routes existing keys
 * through the commit gateway, which reinforces content but silently
 * DROPS the new rubric metadata — exactly the axes this backfill
 * exists to write. Expiry uses the category-ttl policy (reply_judgment
 * -> default 90d), matching what the TTL layer would assign.
 *
 * Modes:
 *   dry-run (default) · reads candidates, prints the plan + cost
 *     estimate · NO LLM calls, NO writes.
 *   --live · judges via the provider chain (~$0.0001/reply) and
 *     upserts. Idempotent: a second run skips messages whose backfill
 *     row (or full 8-axis judgment) already exists.
 *
 * Usage (from apps/statenour):
 *   pnpm backfill:persona                 # dry-run plan
 *   pnpm backfill:persona --live          # judge + write, default cap 200
 *   pnpm backfill:persona --live --take 500
 *
 * ENV TRAP (witnessed 2026-08-18): `.env.local` deliberately carries a
 * 5-char placeholder OLLAMA_API_KEY and a localhost OLLAMA_BASE_URL for
 * test isolation, and @next/env gives it precedence over `.env` — so
 * under the cost firewall the chain sees ZERO available providers and
 * every judge call fails. Real process env outranks all env files;
 * lift the two real values for the run (values from `.env`):
 *   export OLLAMA_API_KEY=<real key> ; export OLLAMA_BASE_URL=https://ollama.com
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { Module } from "node:module";

import type { Prisma } from "@prisma/client";

import { BACKFILL_KEY_PREFIX, planBackfillRow } from "../lib/ai/judge-eval/backfill";

/**
 * Neutralize `server-only` for this standalone tsx script — same
 * pattern as scripts/measure-prompt-size.ts (see its comment for the
 * full mechanism). judgeReply dynamically imports traced-aichat, which
 * does `import "server-only"` and throws under bare tsx; returning an
 * empty module is exactly what server-only's own react-server build
 * does. Tooling-only; the production RSC build is unaffected.
 */
function neutralizeServerOnly(): void {
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

const DEFAULT_TAKE = 200;
const EST_COST_PER_EVAL_USD = 0.0001;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const LIVE = process.argv.includes("--live");

interface Candidate {
  messageId: string;
  conversationId: string;
  userQuery: string;
  assistantReply: string;
  alreadyJudged: boolean;
}

async function main(): Promise<void> {
  neutralizeServerOnly();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to run against an unknown DB.");
  }
  const take = Number(flag("take") ?? DEFAULT_TAKE);
  if (!Number.isInteger(take) || take < 1 || take > 2_000) {
    throw new Error(`--take must be an integer 1-2000, got: ${flag("take")}`);
  }

  const { prisma } = await import("../lib/prisma");

  // ── 1 · Recent assistant replies worth judging ────────────────────
  const replies = await prisma.chatMessage.findMany({
    where: {
      role: "assistant",
      // Substantive replies only — judging "ok." wastes a judge call.
      content: { not: "" },
    },
    orderBy: { createdAt: "desc" },
    take: take * 2, // headroom: some drop below for no user turn / too short
    select: { id: true, conversationId: true, content: true, createdAt: true },
  });

  // ── 2 · Existing judgment state (both key shapes) ─────────────────
  const ids = replies.map((r) => r.id);
  const existing = await prisma.brainMemory.findMany({
    where: {
      category: "reply_judgment",
      key: { in: ids.flatMap((id) => [`judge_${id}`, `${BACKFILL_KEY_PREFIX}${id}`]) },
    },
    select: { key: true, metadata: true },
  });
  const byKey = new Map(existing.map((e) => [e.key, e]));

  const hasPersonaAxes = (metadata: unknown): boolean => {
    const rubric = ((metadata as Record<string, unknown> | null)?.rubric ?? {}) as Record<
      string,
      unknown
    >;
    return typeof rubric.obedience === "number";
  };

  // ── 3 · Build the candidate plan ──────────────────────────────────
  const candidates: Candidate[] = [];
  let skippedDone = 0;
  let skippedShort = 0;
  let skippedNoUserTurn = 0;

  for (const r of replies) {
    if (candidates.length >= take) break;
    if (r.content.trim().length < 40) {
      skippedShort++;
      continue;
    }
    const full = byKey.get(`judge_${r.id}`);
    const bf = byKey.get(`${BACKFILL_KEY_PREFIX}${r.id}`);
    // Already covered: a full row that carries persona axes (live post-
    // #1649 judgment or a prior full backfill), or an existing bf row.
    if (bf || (full && hasPersonaAxes(full.metadata))) {
      skippedDone++;
      continue;
    }
    const userTurn = await prisma.chatMessage.findFirst({
      where: { conversationId: r.conversationId, role: "user", createdAt: { lt: r.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (!userTurn || userTurn.content.trim().length === 0) {
      skippedNoUserTurn++;
      continue;
    }
    candidates.push({
      messageId: r.id,
      conversationId: r.conversationId,
      userQuery: userTurn.content,
      assistantReply: r.content,
      alreadyJudged: Boolean(full),
    });
  }

  const alreadyJudgedCount = candidates.filter((c) => c.alreadyJudged).length;
  process.stderr.write(
    [
      `persona backfill · ${LIVE ? "LIVE" : "dry-run"}`,
      `  scanned         : ${replies.length} assistant replies (newest first)`,
      `  candidates      : ${candidates.length} (cap ${take})`,
      `    · full 8-axis rows (never judged)      : ${candidates.length - alreadyJudgedCount}`,
      `    · persona-only bf rows (already judged): ${alreadyJudgedCount}`,
      `  skipped         : ${skippedDone} covered · ${skippedShort} too short · ${skippedNoUserTurn} no user turn`,
      `  est. judge cost : ~$${(candidates.length * EST_COST_PER_EVAL_USD).toFixed(4)}`,
      "",
    ].join("\n"),
  );

  if (!LIVE) {
    process.stderr.write("dry-run complete — re-run with --live to judge + write.\n");
    return;
  }

  // ── 4 · Judge + upsert (live) ─────────────────────────────────────
  const { judgeReply } = await import("../lib/ai/judge-eval");
  const { computeExpiresAt } = await import("../lib/brain/category-ttl");

  let written = 0;
  let judgeFailures = 0;
  const backfilledAt = new Date().toISOString();

  for (const [i, c] of candidates.entries()) {
    process.stderr.write(`  [${i + 1}/${candidates.length}] ${c.messageId} `);
    const report = await judgeReply({
      userQuery: c.userQuery,
      assistantReply: c.assistantReply,
    });
    if (!report) {
      judgeFailures++;
      process.stderr.write("JUDGE FAILED (skipped)\n");
      continue;
    }
    const plan = planBackfillRow(c.messageId, c.alreadyJudged, report, backfilledAt);
    await prisma.brainMemory.upsert({
      where: { category_key: { category: "reply_judgment", key: plan.key } },
      create: {
        category: "reply_judgment",
        key: plan.key,
        content: plan.content,
        source: "persona-backfill",
        confidence: 0.5,
        expiresAt: computeExpiresAt("reply_judgment"),
        metadata: plan.metadata as Prisma.InputJsonValue,
      },
      // Idempotency backstop — normally unreachable (covered keys are
      // skipped above), reachable only when two runs race.
      update: { content: plan.content, metadata: plan.metadata as Prisma.InputJsonValue },
    });
    written++;
    process.stderr.write(
      `obedience ${report.rubric.obedience} · nonSyco ${report.rubric.nonSycophancy} · cal ${report.rubric.calibration} · via ${report.judgedBy}\n`,
    );
  }

  process.stderr.write(
    [
      "",
      `persona backfill LIVE complete`,
      `  written        : ${written} row(s)`,
      `  judge failures : ${judgeFailures} (provider errors — safe to re-run, they were not marked covered)`,
      "",
    ].join("\n"),
  );

  // Partial success must not read as clean (harvest-eval-corpus rule).
  if (judgeFailures > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    process.stderr.write(
      `persona backfill FAILED\n  ${err instanceof Error ? err.message : String(err)}\n`,
    );
    try {
      const { prisma } = await import("../lib/prisma");
      await prisma.$disconnect();
    } catch {
      /* best-effort */
    }
    process.exit(1);
  });
