/**
 * scripts/arbiter-judge-split.ts · 2026-10-16 (Brain W1, the retrieval arbiter)
 *
 * The second instrument for promoting NICK_RECALL_ARBITER (the first is the
 * frozen corpus in scripts/recall-eval.ts, absent on some machines): split the
 * judge's reply_judgment composites by whether the turn was ASSIGNED to the
 * arbiter, read from the chat message's persisted contextReceipt.arbiterAssigned
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
 *   pnpm exec tsx scripts/arbiter-judge-split.ts --since 2026-10-02   # from UTC midnight; overrides --days
 *
 * The control arm is all pre-flip, so any read after 2026-10-17 must reach back
 * before the flip: use --since, or a rolling --days window drains the control
 * arm and the verdict stays "cannot tell (n too small)" for ever.
 *
 * Prints: the window, then one row per assignment (true / false / unknown)
 * with n, mean composite, p50 composite, clusters (conversations; ET day when
 * the message row is gone), the cluster-robust SE and the 95% CI of the mean
 * (n/a under 2 clusters), then the pack-rendered rate inside the assigned
 * bucket (contextReceipt.arbiter), then `difference true-false: <diff>
 * [low, high] -> <verdict>` (better / worse / cannot tell / cannot tell (n too
 * small) under 5 clusters or 20 turns on either arm), then, when the control
 * arm is the small one, a line naming its size and --since, then the rule.
 * The flag went ON 2026-10-17, so true = after, false = before: a before/after
 * split, not randomized, and the output says so. Splitting by `arbiter` instead
 * would move flag-on turns with no recall into the control group (PR #3088
 * CX-6). Assignment (assignmentForSplit): the receipt's arbiterAssigned
 * true/false wins when present; absent and the message was created before
 * FLAG_FLIP_AT (2026-10-17T04:49:22Z) -> false; absent at or after the flip ->
 * unknown; message row gone -> unknown. Absent-before-flip as false is safe
 * because the flag defaulted OFF and no feature_flags override existed before
 * the audited flip, so every such turn ran with the arbiter off (the W1
 * receipt field shipped after the last pre-flip turn, which is why they lack
 * it). A pre-flip receipt saying true cannot exist; if one appears, the
 * receipt is trusted. "unknown" is reported but never pooled into the
 * difference.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

type ArbiterState = "true" | "false" | "unknown";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? "");
}

/**
 * The window start: `--since YYYY-MM-DD` (UTC midnight of that date, must be a
 * real past date) overrides `--days N` (N days back from now, default 7).
 */
export function parseWindow(argv: string[], now: Date): { since: Date; label: string } | { error: string } {
  const sinceArg = flag(argv, "since");
  if (sinceArg !== undefined) {
    const since = new Date(`${sinceArg}T00:00:00Z`);
    const real = /^\d{4}-\d{2}-\d{2}$/.test(sinceArg) && !Number.isNaN(since.getTime()) && since.toISOString().slice(0, 10) === sinceArg;
    if (!real || since >= now) return { error: `--since must be a past date as YYYY-MM-DD, got "${sinceArg}"` };
    return { since, label: `since ${sinceArg} (UTC midnight)` };
  }
  const days = Number(flag(argv, "days") ?? 7);
  if (!Number.isFinite(days) || days <= 0) return { error: `--days must be a positive number, got "${flag(argv, "days")}"` };
  return { since: new Date(now.getTime() - days * 86_400_000), label: `window ${days} days` };
}

function p50(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** One boolean field of the persisted receipt at tokenUsage.contextReceipt; absent or not a boolean = unknown. */
function receiptField(tokenUsage: unknown, field: "arbiter" | "arbiterAssigned"): ArbiterState {
  if (!tokenUsage || typeof tokenUsage !== "object") return "unknown";
  const receipt = (tokenUsage as { contextReceipt?: unknown }).contextReceipt;
  if (!receipt || typeof receipt !== "object") return "unknown";
  const a = (receipt as Record<string, unknown>)[field];
  return a === true ? "true" : a === false ? "false" : "unknown";
}

/** Did an evidence pack reach the prompt (contextReceipt.arbiter)? */
export function arbiterStateOf(tokenUsage: unknown): ArbiterState {
  return receiptField(tokenUsage, "arbiter");
}

/** Was the turn assigned to the arbiter (contextReceipt.arbiterAssigned, the flag state)? The pure receipt read. */
export function arbiterAssignmentOf(tokenUsage: unknown): ArbiterState {
  return receiptField(tokenUsage, "arbiterAssigned");
}

// NICK_RECALL_ARBITER went ON via the audited feature_flags override (first AuditEvent); default OFF, no override before.
export const FLAG_FLIP_AT = new Date("2026-10-17T04:49:22Z");

/**
 * The split key: the receipt's arbiterAssigned when present; absent and the
 * message predates FLAG_FLIP_AT -> "false" (the flag was provably off); absent
 * at or after the flip, or the message row gone -> "unknown".
 */
export function assignmentForSplit(tokenUsage: unknown, messageCreatedAt: Date | undefined): ArbiterState {
  const fromReceipt = arbiterAssignmentOf(tokenUsage);
  if (fromReceipt !== "unknown") return fromReceipt;
  return messageCreatedAt && messageCreatedAt < FLAG_FLIP_AT ? "false" : "unknown";
}

/**
 * The cluster a judged turn belongs to: its conversation (turns in one
 * conversation are correlated), else, when the message row is gone, the judge
 * row's ET calendar day. Never the message id: that would make every turn its
 * own cluster and shrink the interval back to the naive one.
 */
export function clusterKeyOf(conversationId: string | null | undefined, judgedAt: Date): string {
  return conversationId ? conversationId : `day:${judgedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`;
}

export interface ClusteredScore {
  composite: number;
  cluster: string;
}

export interface JudgeSplit {
  /** Composites per assignment. */
  buckets: Record<ArbiterState, number[]>;
  /** The same composites with their cluster key, for the interval. */
  clustered: Record<ArbiterState, ClusteredScore[]>;
  /** Inside the assigned=true bucket only: how many turns had a pack rendered (arbiter true / false / unknown). */
  rendered: Record<ArbiterState, number>;
}

/** `tokenUsage` / `conversationId` / `messageCreatedAt` undefined = the message row is gone (unknown, clustered by ET day). */
export function splitJudgments(
  rows: Iterable<{
    composite: number;
    tokenUsage?: unknown;
    conversationId?: string | null;
    messageCreatedAt?: Date;
    judgedAt: Date;
  }>,
): JudgeSplit {
  const out: JudgeSplit = {
    buckets: { true: [], false: [], unknown: [] },
    clustered: { true: [], false: [], unknown: [] },
    rendered: { true: 0, false: 0, unknown: 0 },
  };
  for (const { composite, tokenUsage, conversationId, messageCreatedAt, judgedAt } of rows) {
    const assigned = assignmentForSplit(tokenUsage, messageCreatedAt);
    out.buckets[assigned].push(composite);
    out.clustered[assigned].push({ composite, cluster: clusterKeyOf(conversationId, judgedAt) });
    if (assigned === "true") out.rendered[arbiterStateOf(tokenUsage)]++;
  }
  return out;
}

// Two-sided 95% Student t quantiles t(0.975, df) for df 1..30; 1.96 above 30.
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** t(0.975, df); NaN for df < 1 (no interval exists). */
export function tQuantile975(df: number): number {
  if (!(df >= 1)) return NaN;
  return df > 30 ? 1.96 : T975[Math.floor(df) - 1];
}

export interface ArmSummary {
  n: number;
  clusters: number;
  mean: number;
  /** Cluster-robust SE of the mean; NaN when G < 2 (unknown, never 0). */
  se: number;
  ciLow: number;
  ciHigh: number;
}

/**
 * Sample mean plus the cluster-robust SE of the mean:
 *   se = sqrt( G/(G-1) * sum_g s_g^2 ) / n,  s_g = sum over cluster g of (x - mean)
 * CI = mean +/- t(0.975, G-1) * se.
 * Matches inspect_ai src/inspect_ai/scorer/_metrics/std.py `_clustered_stderr`
 * exactly (squared cluster deviation sums, finite-cluster correction G/(G-1),
 * divided by total n), because that is the arXiv 2411.00640 Appendix A estimator
 * with the small-G correction we need at a handful of conversations. One
 * deliberate divergence: inspect_ai returns 0.0 for G < 2; we return NaN, since
 * a zero SE would print a zero-width interval and a confident verdict.
 */
export function summarizeArm(rows: ClusteredScore[]): ArmSummary {
  const n = rows.length;
  const m = mean(rows.map((r) => r.composite));
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.cluster, (sums.get(r.cluster) ?? 0) + (r.composite - m));
  const G = sums.size;
  if (G < 2) return { n, clusters: G, mean: m, se: NaN, ciLow: NaN, ciHigh: NaN };
  let ss = 0;
  for (const s of sums.values()) ss += s * s;
  const se = Math.sqrt((G / (G - 1)) * ss) / n;
  const half = tQuantile975(G - 1) * se;
  return { n, clusters: G, mean: m, se, ciLow: m - half, ciHigh: m + half };
}

export type Verdict = "better" | "worse" | "cannot tell" | "cannot tell (n too small)";

const MIN_CLUSTERS = 5;
const MIN_N = 20;

/**
 * treat - control with se = sqrt(se_t^2 + se_c^2), treating the arms as
 * independent. A conversation that spans the flip lands in both arms, so this
 * is slightly anti-conservative; df = min(G_t, G_c) - 1 pulls the other way.
 * The verdict reads the interval, never the point estimate.
 */
export function compareArms(
  treat: ArmSummary,
  control: ArmSummary,
): { diff: number; se: number; ciLow: number; ciHigh: number; verdict: Verdict } {
  const diff = treat.mean - control.mean;
  const se = Math.sqrt(treat.se ** 2 + control.se ** 2);
  const half = tQuantile975(Math.min(treat.clusters, control.clusters) - 1) * se;
  const ciLow = diff - half;
  const ciHigh = diff + half;
  const small = [treat, control].some((a) => a.clusters < MIN_CLUSTERS || a.n < MIN_N);
  const verdict: Verdict = small
    ? "cannot tell (n too small)"
    : ciLow > 0
      ? "better"
      : ciHigh < 0
        ? "worse"
        : "cannot tell";
  return { diff, se, ciLow, ciHigh, verdict };
}

export const DECISION_RULE =
  "rule: worse -> switch the flag off; better or cannot tell -> keep it on and re-read in a week with --since 2026-10-02 (the window must reach before the 2026-10-17 flip: false = before, true = after). Before/after split, not randomized: a difference can be time, not the arbiter.";

/** Why the read cannot tell when the CONTROL (pre-flip) arm is the small one; null when it is big enough. */
export function controlArmNote(control: ArmSummary): string | null {
  if (control.clusters >= MIN_CLUSTERS && control.n >= MIN_N) return null;
  return `control arm (before the flip) has ${control.n} turns in ${control.clusters} conversations: widen the window with --since`;
}

async function main(): Promise<void> {
  const window = parseWindow(process.argv, new Date());
  if ("error" in window) {
    console.error(window.error);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run against an unknown DB.");
    process.exit(1);
  }

  const { since, label } = window;
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // Scored judge rows only: the "judge_unavailable_<id>" coverage rows carry no composite.
    const judged = await prisma.brainMemory.findMany({
      where: { category: "reply_judgment", deletedAt: null, createdAt: { gte: since }, key: { startsWith: "judge_" } },
      select: { key: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const byMessage = new Map<string, { composite: number; judgedAt: Date }>();
    for (const row of judged) {
      const meta = (row.metadata ?? {}) as { messageId?: unknown; composite?: unknown };
      const messageId = typeof meta.messageId === "string" ? meta.messageId : row.key.replace(/^judge_/, "");
      if (row.key.startsWith("judge_unavailable_")) continue;
      if (typeof meta.composite !== "number" || !Number.isFinite(meta.composite)) continue;
      // newest judgment per message wins
      if (!byMessage.has(messageId)) byMessage.set(messageId, { composite: meta.composite, judgedAt: row.createdAt });
    }

    const messageIds = [...byMessage.keys()];
    const messages = messageIds.length
      ? await prisma.chatMessage.findMany({
          where: { id: { in: messageIds } },
          select: { id: true, tokenUsage: true, conversationId: true, createdAt: true },
        })
      : [];
    const messageById = new Map(messages.map((m) => [m.id, m]));

    const { buckets, clustered, rendered } = splitJudgments(
      [...byMessage].map(([messageId, { composite, judgedAt }]) => ({
        composite,
        judgedAt,
        tokenUsage: messageById.get(messageId)?.tokenUsage,
        conversationId: messageById.get(messageId)?.conversationId,
        messageCreatedAt: messageById.get(messageId)?.createdAt,
      })),
    );

    const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
    const arms = { true: summarizeArm(clustered.true), false: summarizeArm(clustered.false), unknown: summarizeArm(clustered.unknown) };
    console.log(`arbiter judge-split · ${label} (since ${since.toISOString()}) · ${judged.length} judge rows, ${byMessage.size} scored messages, ${messages.length} message rows found`);
    console.log("assigned  n     mean   p50    clusters se     ci95");
    for (const state of ["true", "false", "unknown"] as const) {
      const xs = [...buckets[state]].sort((a, b) => a - b);
      const a = arms[state];
      console.log(
        `${state.padEnd(9)} ${String(xs.length).padEnd(5)} ${fmt(mean(xs)).padEnd(6)} ${fmt(p50(xs)).padEnd(6)} ${String(a.clusters).padEnd(8)} ${fmt(a.se).padEnd(6)} [${fmt(a.ciLow)}, ${fmt(a.ciHigh)}]`,
      );
    }
    console.log(`pack rendered in assigned turns: ${rendered.true} yes, ${rendered.false} no, ${rendered.unknown} unknown (of ${buckets.true.length})`);
    if (buckets.true.length === 0) {
      console.log("note: no assigned=true turns in the window — the flag is off or the receipts predate arbiterAssigned; this split cannot judge the arbiter yet.");
    }
    // The unknown arm is reported above and never pooled into either side.
    const cmp = compareArms(arms.true, arms.false);
    console.log(`difference true-false: ${fmt(cmp.diff)} [${fmt(cmp.ciLow)}, ${fmt(cmp.ciHigh)}] -> ${cmp.verdict}`);
    const note = controlArmNote(arms.false);
    if (note) console.log(note);
    console.log(DECISION_RULE);
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a CLI (tsx scripts/arbiter-judge-split.ts); importing the module (tests) runs nothing.
if (/arbiter-judge-split\.[cm]?[jt]s$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))) {
  main().catch((e) => {
    console.error("arbiter-judge-split failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
