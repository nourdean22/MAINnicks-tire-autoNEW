/**
 * lib/ai/trajectory-grader.ts · GATE-2026-08-14 item #4 (2026-08-18).
 *
 * The gate called trajectory grading "the best item in Scan B", and the
 * reason is a blind spot no text judge can see: judge-eval scores the
 * REPLY, but a turn is a TRAJECTORY — the sequence of tool calls and
 * receipts that produced the reply. A perfect-sounding answer atop a
 * wasteful, failing, or ungrounded action sequence scores 9/10 on text
 * axes today. This module grades the sequence itself.
 *
 * TWO LAYERS, deliberately:
 *   1 · STRUCTURAL (pure, deterministic, free): counts that need no
 *       model — failures, recoveries (a failed tool re-fired later),
 *       redundant calls (same tool + same args twice), duration. These
 *       are FACTS and are precomputed BEFORE the judge sees anything,
 *       so the LLM grades on top of ground truth instead of re-deriving
 *       it (and mis-deriving it — the fast judge miscounts).
 *   2 · JUDGED (one classify call, ~$0.0001): four axes the structure
 *       alone can't decide —
 *         actionSelection · were these the right tools for the ask?
 *         efficiency      · was work wasted (beyond literal dupes)?
 *         grounding       · does the reply's story match the receipts?
 *         recovery        · were failures surfaced/retried, or papered
 *                           over as success?
 *
 * Persistence mirrors reply_judgment but as its OWN one-shot category
 * (`trajectory_judgment`, 90d TTL, direct prisma upsert — remember()
 * drops metadata on existing keys and 24h-probations one-shot creates;
 * both lessons from #1652). Kept separate from reply_judgment so the
 * persona census's comparability is untouched.
 *
 * Fires only when a turn actually HAS a trajectory
 * (capturedToolCalls.length > 0) — grading the empty sequence is free
 * noise. Fire-and-forget post-persist, same station as judgeReplyAsync.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
import type { CapturedToolCall } from "@/lib/services/chat/tool-telemetry-walk";

const log = rootLogger.withSurface("ai/trajectory-grader");

// ── Layer 1 · structural facts (pure) ────────────────────────────────

export interface TrajectoryStructure {
  toolCount: number;
  failedCount: number;
  /** Failed calls whose SAME tool was re-fired later in the sequence. */
  recoveredCount: number;
  /** Calls repeating an earlier (name + identical args) invocation. */
  redundantCount: number;
  totalDurationMs: number;
  /** Names in firing order — the judge sees the real sequence. */
  sequence: string[];
}

export function analyzeTrajectory(calls: readonly CapturedToolCall[]): TrajectoryStructure {
  const seenArgs = new Set<string>();
  let redundantCount = 0;
  for (const c of calls) {
    // Args-less calls dedupe by name alone — two bare getTasks() calls
    // in one turn are redundant; two searches with different queries
    // are not.
    const key = `${c.name}::${c.args ? JSON.stringify(c.args) : ""}`;
    if (seenArgs.has(key)) redundantCount++;
    else seenArgs.add(key);
  }

  let recoveredCount = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i].ok) continue;
    if (calls.slice(i + 1).some((later) => later.name === calls[i].name)) {
      recoveredCount++;
    }
  }

  return {
    toolCount: calls.length,
    failedCount: calls.filter((c) => !c.ok).length,
    recoveredCount,
    redundantCount,
    totalDurationMs: calls.reduce((s, c) => s + (Number.isFinite(c.durationMs) ? c.durationMs : 0), 0),
    sequence: calls.map((c) => `${c.name}${c.ok ? "" : "✗"}`),
  };
}

// ── Layer 2 · the trajectory judge ───────────────────────────────────

export interface TrajectoryRubric {
  actionSelection: number; // 0-10
  efficiency: number;      // 0-10
  grounding: number;       // 0-10
  recovery: number;        // 0-10
}

export interface TrajectoryReport {
  composite: number; // mean of the 4 axes
  rubric: TrajectoryRubric;
  structure: TrajectoryStructure;
  reasoning: string;
  flagForReview: boolean; // composite < 6
  judgedBy: string;
  durationMs: number;
}

const FLAG_THRESHOLD = 6;

const JUDGE_SYSTEM = `You are a trajectory judge for an operator-grade personal-OS AI named Nick. You do NOT grade the reply's prose — a separate judge does that. You grade the ACTION SEQUENCE that produced it. Score 4 axes (0-10 each):

ACTION_SELECTION — were these the right tools for the ask? Wrong tool, or an obviously needed tool never fired, scores low. A turn needing no more tools than it used scores high.
EFFICIENCY — was work wasted? Redundant calls are precomputed for you as FACTS — trust them over your own recount. Also penalize obviously unnecessary calls for the ask.
GROUNDING — does the reply's story match the receipts? Claims of done-ness with no matching successful call, or numbers the tools never returned, score low.
RECOVERY — when calls failed (marked ✗), were they retried or honestly surfaced in the reply? Failures silently papered over as success score 0-2. No failures = score 8 (nothing to recover).

Output JSON only:
{"actionSelection":0-10,"efficiency":0-10,"grounding":0-10,"recovery":0-10,"reasoning":"one line · max 80 chars"}

NO MARKDOWN. NO PROSE OUTSIDE JSON. Be terse.`;

export interface TrajectoryArgs {
  userQuery: string;
  replyText: string;
  calls: readonly CapturedToolCall[];
}

function renderReceipts(calls: readonly CapturedToolCall[], s: TrajectoryStructure): string {
  const rows = calls
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} · ${c.ok ? "ok" : "FAILED"} · ${Math.round(c.durationMs)}ms${
          c.args ? ` · args ${JSON.stringify(c.args).slice(0, 120)}` : ""
        }`,
    )
    .join("\n");
  return `RECEIPTS (ground truth — precomputed, do not recount):
${rows}
FACTS: ${s.toolCount} calls · ${s.failedCount} failed · ${s.recoveredCount} recovered · ${s.redundantCount} redundant · ${Math.round(s.totalDurationMs)}ms total`;
}

function clamp(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

async function _gradeTrajectory(args: TrajectoryArgs): Promise<TrajectoryReport | null> {
  if (args.calls.length === 0) return null; // no trajectory, nothing to grade
  const startedAt = Date.now();
  const structure = analyzeTrajectory(args.calls);

  const { aiChat } = await import("@/lib/ai/provider");
  const result = await aiChat(
    [
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `OPERATOR ASKED: ${args.userQuery.slice(0, 800)}

${renderReceipts(args.calls, structure)}

NICK'S FINAL REPLY: ${args.replyText.slice(0, 1800)}

Score the trajectory. Output JSON only.`,
      },
    ],
    "classify",
  );
  // The repo gotcha — aiChat returns a sentinel, never throws.
  if (result.provider === "emergency" || result.provider === "none") return null;

  const text = (result.content ?? "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn("trajectory_judge_no_json", { preview: text.slice(0, 160) });
    return null;
  }
  let parsed: Partial<TrajectoryRubric & { reasoning: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    log.warn("trajectory_judge_parse_failed", { preview: jsonMatch[0].slice(0, 160) });
    return null;
  }

  const rubric: TrajectoryRubric = {
    actionSelection: clamp(parsed.actionSelection),
    efficiency: clamp(parsed.efficiency),
    grounding: clamp(parsed.grounding),
    recovery: clamp(parsed.recovery),
  };
  const composite =
    (rubric.actionSelection + rubric.efficiency + rubric.grounding + rubric.recovery) / 4;

  return {
    composite: Math.round(composite * 10) / 10,
    rubric,
    structure,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 200) : "",
    flagForReview: composite < FLAG_THRESHOLD,
    judgedBy: `${result.provider ?? "?"}:${result.model ?? "?"}`,
    durationMs: Date.now() - startedAt,
  };
}

export const gradeTrajectory = withGuardian("trajectory-grader", _gradeTrajectory, {
  timeoutMs: 8_000,
  maxRetries: 1,
  reliabilityOnly: true,
});

/**
 * Fire-and-forget · grades + persists as a `trajectory_judgment` row
 * keyed `traj_<messageId>`. Direct prisma upsert with the category-ttl
 * policy — NOT brainMemory.remember(): remember() 24h-probations
 * one-shot creates and silently drops metadata on existing keys (the
 * #1652 lessons, both).
 */
export async function gradeTrajectoryAsync(args: TrajectoryArgs & { messageId: string }) {
  try {
    const report = await gradeTrajectory(args);
    if (!report) return;

    const { prisma } = await import("@/lib/prisma");
    const { computeExpiresAt } = await import("@/lib/brain/category-ttl");
    const content = `Trajectory ${report.composite}/10 · ${report.structure.toolCount} calls · ${report.reasoning}`;
    // Spread into plain records — Prisma's InputJsonObject wants index
    // signatures the named interfaces deliberately don't carry.
    const metadata = {
      messageId: args.messageId,
      rubric: { ...report.rubric },
      structure: { ...report.structure, sequence: [...report.structure.sequence] },
      composite: report.composite,
      flagForReview: report.flagForReview,
      judgedBy: report.judgedBy,
    };
    await prisma.brainMemory.upsert({
      where: { category_key: { category: "trajectory_judgment", key: `traj_${args.messageId}` } },
      create: {
        category: "trajectory_judgment",
        key: `traj_${args.messageId}`,
        content,
        source: "trajectory-grader",
        confidence: 0.5,
        expiresAt: computeExpiresAt("trajectory_judgment"),
        metadata,
      },
      update: { content, metadata },
    });

    if (report.flagForReview) {
      log.warn("trajectory_low_score", {
        messageId: args.messageId,
        composite: report.composite,
        rubric: report.rubric,
        structure: report.structure,
      });
    }
  } catch (err) {
    log.warn("trajectory_grade_failed", {
      messageId: args.messageId,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}
