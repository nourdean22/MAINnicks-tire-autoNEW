/**
 * v10.0.528 · Nightly eval regression harness.
 *
 * Complements `lib/ai/judge-eval.ts` (real-time per-reply scoring).
 * THIS module replays a FROZEN set of golden questions through the
 * chat pipeline once a night and asserts pass/fail against expected
 * criteria — the "is the brain still answering the basics right?"
 * smoke test.
 *
 * Design choices:
 *   · Golden questions are static JSON (data/golden-questions.json)
 *     so they're diff-reviewable + version-controlled. New tests
 *     land via PR, not runtime mutation.
 *   · Each case scores against deterministic predicates (substring,
 *     length, tool-call) — no LLM-as-judge here. Keeps the harness
 *     itself a known quantity so a regression is a real signal, not
 *     a judge-model drift artifact.
 *   · Runs in-process by importing chat route POST + synthesizing a
 *     Request. No HTTP loop, no flake from local network.
 *   · One question fails → whole question fails, but the suite
 *     keeps running. Operator gets the full failure list, not first
 *     red and bail.
 *   · `runRegressionSuite()` is a pure compute function (no DB
 *     writes, no Telegram). The cron route wires those side-effects
 *     so this module stays unit-testable.
 *
 * Golden-question shape extensions (v10.0.528 · roadmap Arc A #4):
 *
 *   The original 35 questions use these `expected.*` fields:
 *     · shouldCallTool (string | null)
 *     · mustContain / mustNotContain (string[])
 *     · minLength / maxLength (number)
 *
 *   Four NEW categories layer on additional fields:
 *
 *   1. brain_recall_precision
 *        expected.expectedWisdomIds   string[]   wisdom-id prefixes that
 *                                                MUST appear in the
 *                                                agent-trace `brainMemoryIds`
 *                                                (any-of match, prefix-aware
 *                                                so `wisdom_naval_*` matches
 *                                                `wisdom_naval_07`)
 *        expected.mustReferenceWisdom boolean    require the system-prompt
 *                                                wisdom block to have fired
 *                                                (any brain-memory pulled)
 *
 *   2. tool_use_correctness
 *        expected.expectedToolFired   string     tool name that MUST appear
 *                                                in the turn's tool-call list.
 *                                                Strict equality unlike
 *                                                shouldCallTool (which can
 *                                                co-exist with no-tool).
 *
 *   3. voice_intent_classification
 *        expected.expectedIntent      string     one of: booking · callback ·
 *                                                price · transfer · general ·
 *                                                emergency. Scorer falls back
 *                                                to substring-on-reply when
 *                                                no classifier metadata.
 *
 *   4. anti_pattern_detection
 *        expected.expectedAntiPatternId  string?  optional · BrainMemory `key`
 *                                                 to look for in trace
 *        expected.mustReferenceAntiPattern boolean require surfaceAntiPatterns
 *                                                  to have fired OR the reply
 *                                                  to contain anti-pattern
 *                                                  language ("you broke", "you
 *                                                  said you would", etc.)
 *
 *   The pipeline runner is expected to emit an `agentTrace` block alongside
 *   reply + toolCalls. When absent (e.g. test mocks), the new scorers
 *   degrade gracefully: prefix-substring match on reply for wisdomIds, and
 *   any-tool-fired for anti-pattern. This keeps the existing 35 questions
 *   100% backwards-compatible.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("eval/regression-runner");

// ── Types ──────────────────────────────────────────────────────────

export interface GoldenExpected {
  /** Tool the assistant should call (by name), or null if no tool. */
  shouldCallTool?: string | null;
  /** Substrings that MUST appear in the final reply (case-insensitive, any-of). */
  mustContain?: string[];
  /** Substrings that MUST NOT appear in the reply (case-insensitive). */
  mustNotContain?: string[];
  /** Minimum reply length (chars). */
  minLength?: number;
  /** Maximum reply length (chars). Cheap sanity cap. */
  maxLength?: number;
  /**
   * v10.0.528 · brain_recall_precision · wisdom-id (or prefix · trailing
   * `*` allowed) that the system-prompt MUST have pulled from BrainMemory.
   * Any-of match against `agentTrace.brainMemoryIds`. Falls back to
   * substring scan of the reply when no agent-trace metadata is present.
   */
  expectedWisdomIds?: string[];
  /**
   * v10.0.528 · brain_recall_precision · gate on the wisdom block firing
   * at all (any brain_memory hit). Useful for "the recall layer is dead"
   * regressions where IDs change but recall silently no-ops.
   */
  mustReferenceWisdom?: boolean;
  /**
   * v10.0.528 · tool_use_correctness · the SPECIFIC tool the agent must
   * fire. Distinct from `shouldCallTool` which is the legacy any-of-many
   * field; `expectedToolFired` is strict equality and ALSO tolerates
   * additional tool calls (which `shouldCallTool` does too, but this
   * field documents intent for the new category).
   */
  expectedToolFired?: string;
  /**
   * v10.0.528 · voice_intent_classification · classifier label the
   * utterance should resolve to. Scorer first consults
   * `agentTrace.classifiedIntent` (when the pipeline emits it); falls
   * back to substring search on the reply.
   */
  expectedIntent?: "booking" | "callback" | "price" | "transfer" | "general" | "emergency";
  /**
   * v10.0.528 · anti_pattern_detection · optional BrainMemory.key that
   * must appear in `agentTrace.antiPatternKeys`. When omitted but
   * `mustReferenceAntiPattern` is true, any anti-pattern surfacing is
   * acceptable.
   */
  expectedAntiPatternId?: string;
  /**
   * v10.0.528 · anti_pattern_detection · require surfaceAntiPatterns to
   * have fired OR the reply to contain anti-pattern callout language
   * ("you broke", "you said you would", "you keep doing", etc.).
   */
  mustReferenceAntiPattern?: boolean;
}

export type GoldenCategory =
  | "factual"
  | "reasoning"
  | "tool_use"
  | "fabrication_defense"
  | "brand_voice"
  | "brain_recall_precision"
  | "tool_use_correctness"
  | "voice_intent_classification"
  | "anti_pattern_detection";

export interface GoldenQuestion {
  id: string;
  category: GoldenCategory;
  question: string;
  expected: GoldenExpected;
  added: string;
}

/**
 * v10.0.528 · Optional pipeline-trace metadata used by the new scorers.
 * Producers (chat-route + tests) populate only the fields they have;
 * scorers degrade gracefully when fields are missing.
 */
export interface AgentTrace {
  /** BrainMemory ids/keys pulled into the system prompt wisdom block. */
  brainMemoryIds?: string[];
  /** Classifier output for short utterances (voice intent). */
  classifiedIntent?: string;
  /** Anti-pattern BrainMemory keys surfaced (via surfaceAntiPatterns). */
  antiPatternKeys?: string[];
}

export interface QuestionResult {
  id: string;
  category: GoldenQuestion["category"];
  passed: boolean;
  /** 0–1 score (1 = all checks passed). */
  score: number;
  /** Reasons this case failed (empty if passed). */
  failures: string[];
  /** Pipeline reply text (truncated to 800 chars for storage). */
  replyPreview: string;
  /** Tool names invoked during the turn, in order. */
  toolCalls: string[];
  /** End-to-end duration of the turn (ms). */
  durationMs: number;
  /** Whether the pipeline itself errored (treated as fail). */
  pipelineError?: string;
}

export interface CategoryStats {
  category: string;
  total: number;
  passed: number;
  failed: number;
  /** Pass rate for this category, 0–1. */
  passRate: number;
}

export interface RegressionReport {
  ranAt: string;
  totalRan: number;
  passed: number;
  failed: number;
  /** Mean of per-question scores. 1.0 = all green. */
  scoreAvg: number;
  /** Pass rate, 0–1. Same as passed/totalRan but pre-computed for ops. */
  passRate: number;
  perQuestionResults: QuestionResult[];
  durationMs: number;
  /** Most-failed categories (sorted desc). Useful for triage. */
  worstCategories: Array<{ category: string; failed: number; total: number }>;
  /**
   * v10.0.528 · Per-category pass rate + counts. Top-line `passRate`
   * answers "is the suite healthy?"; this answers "which surface is
   * regressing?". Sorted by category name for stable diffs.
   */
  categoryStats: CategoryStats[];
}

export interface RunOptions {
  /** Cap question count (handy for smoke-mode). */
  limit?: number;
  /** Only run a single category. */
  category?: GoldenQuestion["category"];
  /** Override the questions list (used by tests). */
  questionsOverride?: GoldenQuestion[];
  /** Override the per-question runner (used by tests). */
  runnerOverride?: (q: GoldenQuestion) => Promise<{
    reply: string;
    toolCalls: string[];
    durationMs: number;
    pipelineError?: string;
    /**
     * v10.0.528 · Optional pipeline trace. When present, the new
     * scorers (brain-recall / anti-pattern / intent) use it; when
     * absent they fall back to substring scans on the reply.
     */
    agentTrace?: AgentTrace;
  }>;
}

// ── Loader ─────────────────────────────────────────────────────────

const QUESTIONS_PATH = path.join(process.cwd(), "data", "golden-questions.json");

export async function loadGoldenQuestions(): Promise<GoldenQuestion[]> {
  const raw = await fs.readFile(QUESTIONS_PATH, "utf8");
  const parsed = JSON.parse(raw) as GoldenQuestion[];
  if (!Array.isArray(parsed)) {
    throw new Error("golden-questions.json must be an array");
  }
  return parsed;
}

// ── Scoring ────────────────────────────────────────────────────────

/**
 * Match a single wisdom id against the trace `brainMemoryIds`.
 * Supports trailing `*` as a prefix wildcard (so `wisdom_naval_*`
 * matches `wisdom_naval_07`). Match is case-sensitive — IDs are
 * machine-generated keys, never operator copy.
 */
function wisdomIdMatches(expected: string, traceIds: string[]): boolean {
  if (expected.endsWith("*")) {
    const prefix = expected.slice(0, -1);
    return traceIds.some((id) => id.startsWith(prefix));
  }
  return traceIds.includes(expected);
}

/**
 * Heuristic fallback for anti-pattern callouts when no agent trace is
 * available. Looks for second-person blame/recurrence language; cheap
 * substring scan kept on a single source of truth so the test in
 * `tests/eval/regression-runner.test.ts` can pin it.
 */
const ANTI_PATTERN_REPLY_HINTS = [
  "you broke",
  "you said you would",
  "you keep doing",
  "you've done this before",
  "anti-pattern",
  "you've broken this commitment",
  "this is a pattern",
  "broken commitment",
] as const;

/**
 * Pure scoring step · isolated so unit tests can hammer it without
 * spinning up the chat pipeline. Returns { passed, score, failures }.
 *
 * v10.0.528 · `agentTrace` is optional · the original three-arg form
 * still works for the legacy 35 questions whose checks don't need it.
 */
export function scoreReply(
  question: GoldenQuestion,
  reply: string,
  toolCalls: string[],
  agentTrace?: AgentTrace,
): { passed: boolean; score: number; failures: string[] } {
  const failures: string[] = [];
  const exp = question.expected;
  const replyLower = reply.toLowerCase();
  const checks: Array<{ name: string; ok: boolean }> = [];

  // Tool-call check. null means "must NOT call any tool".
  if (exp.shouldCallTool === null) {
    const ok = toolCalls.length === 0;
    checks.push({ name: "no-tool-call", ok });
    if (!ok) failures.push(`unexpected tool calls: ${toolCalls.join(", ")}`);
  } else if (typeof exp.shouldCallTool === "string") {
    const ok = toolCalls.includes(exp.shouldCallTool);
    checks.push({ name: `tool=${exp.shouldCallTool}`, ok });
    if (!ok) failures.push(`expected tool "${exp.shouldCallTool}", got: ${toolCalls.join(", ") || "none"}`);
  }

  // mustContain · ANY-OF · at least one of the listed substrings
  // must be present. Allows synonyms ("no" | "don't" | "haven't")
  // without forcing the assistant into a single phrasing.
  if (exp.mustContain && exp.mustContain.length > 0) {
    const hit = exp.mustContain.find((s) => replyLower.includes(s.toLowerCase()));
    const ok = hit !== undefined;
    checks.push({ name: "must-contain", ok });
    if (!ok) failures.push(`reply missing any of: ${exp.mustContain.join(" | ")}`);
  }

  // mustNotContain · NONE of the listed substrings may appear
  if (exp.mustNotContain && exp.mustNotContain.length > 0) {
    const hits = exp.mustNotContain.filter((s) => replyLower.includes(s.toLowerCase()));
    const ok = hits.length === 0;
    checks.push({ name: "must-not-contain", ok });
    if (!ok) failures.push(`reply contains forbidden: ${hits.join(", ")}`);
  }

  // length bounds — cheap sanity. Empty replies and 50k-char rants
  // are both regressions worth catching.
  if (typeof exp.minLength === "number") {
    const ok = reply.length >= exp.minLength;
    checks.push({ name: "min-length", ok });
    if (!ok) failures.push(`reply too short: ${reply.length} < ${exp.minLength}`);
  }
  if (typeof exp.maxLength === "number") {
    const ok = reply.length <= exp.maxLength;
    checks.push({ name: "max-length", ok });
    if (!ok) failures.push(`reply too long: ${reply.length} > ${exp.maxLength}`);
  }

  // ── v10.0.528 extensions · brain_recall_precision ────────────────
  if (exp.expectedWisdomIds && exp.expectedWisdomIds.length > 0) {
    const traceIds = agentTrace?.brainMemoryIds ?? [];
    let ok: boolean;
    if (traceIds.length > 0) {
      ok = exp.expectedWisdomIds.some((wid) => wisdomIdMatches(wid, traceIds));
    } else {
      // No agent trace · degrade to substring scan of the reply for
      // the bare id (stripping any trailing `*`). Cheap signal,
      // catches "did the wisdom text actually surface anywhere".
      ok = exp.expectedWisdomIds.some((wid) =>
        replyLower.includes(wid.replace(/\*$/, "").toLowerCase()),
      );
    }
    checks.push({ name: "wisdom-recall", ok });
    if (!ok) {
      failures.push(
        `expected wisdom (any-of) ${exp.expectedWisdomIds.join(" | ")}, trace had: ${
          traceIds.join(", ") || "none"
        }`,
      );
    }
  }

  if (exp.mustReferenceWisdom) {
    const traceIds = agentTrace?.brainMemoryIds ?? [];
    const ok = traceIds.length > 0;
    checks.push({ name: "wisdom-block-fired", ok });
    if (!ok) failures.push("expected wisdom block to fire (any brain memory pulled)");
  }

  // ── v10.0.528 extensions · tool_use_correctness ──────────────────
  if (typeof exp.expectedToolFired === "string") {
    const ok = toolCalls.includes(exp.expectedToolFired);
    checks.push({ name: `expected-tool=${exp.expectedToolFired}`, ok });
    if (!ok) {
      failures.push(
        `expected tool "${exp.expectedToolFired}" to fire, got: ${toolCalls.join(", ") || "none"}`,
      );
    }
  }

  // ── v10.0.528 extensions · voice_intent_classification ───────────
  if (exp.expectedIntent) {
    const classified = agentTrace?.classifiedIntent?.toLowerCase();
    let ok: boolean;
    if (classified) {
      ok = classified === exp.expectedIntent;
    } else {
      // Fallback · substring scan on reply. Imperfect but it catches
      // "I'll book you in tomorrow" → booking intent at least 60-70%
      // of the time in dev pre-classifier turns.
      ok = replyLower.includes(exp.expectedIntent);
    }
    checks.push({ name: `intent=${exp.expectedIntent}`, ok });
    if (!ok) {
      failures.push(
        `expected intent "${exp.expectedIntent}", got: ${classified ?? "no-classifier-trace · reply scan miss"}`,
      );
    }
  }

  // ── v10.0.528 extensions · anti_pattern_detection ────────────────
  if (exp.mustReferenceAntiPattern) {
    const traceKeys = agentTrace?.antiPatternKeys ?? [];
    const surfaceFired = toolCalls.includes("surfaceAntiPatterns");
    const replyHints = ANTI_PATTERN_REPLY_HINTS.some((s) => replyLower.includes(s));

    let ok: boolean;
    if (exp.expectedAntiPatternId) {
      ok =
        traceKeys.includes(exp.expectedAntiPatternId) ||
        (surfaceFired && replyHints) ||
        replyLower.includes(exp.expectedAntiPatternId.toLowerCase());
    } else {
      ok = traceKeys.length > 0 || surfaceFired || replyHints;
    }
    checks.push({ name: "anti-pattern-surfaced", ok });
    if (!ok) {
      failures.push(
        exp.expectedAntiPatternId
          ? `expected anti-pattern "${exp.expectedAntiPatternId}" surfaced (trace, tool, or reply); got none`
          : "expected ANY anti-pattern surfacing (trace, surfaceAntiPatterns tool, or reply callout); got none",
      );
    }
  }

  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.ok).length;
  const score = totalChecks === 0 ? 1 : passedChecks / totalChecks;

  return { passed: failures.length === 0, score, failures };
}

// ── Pipeline runner ────────────────────────────────────────────────

/**
 * Run a single golden question through the in-process chat pipeline.
 * Returns the final assistant reply text + tool calls invoked.
 *
 * Implementation notes:
 *   · Imports the chat route's POST handler dynamically · the route
 *     module pulls in next-auth, prisma, etc., which we don't want
 *     to load at test-collect time.
 *   · Synthesizes a Request that mimics what the UI sends. The chat
 *     route's gate parses `messages` in the UI message format.
 *   · Reads the stream chunk-by-chunk. UI message stream framing
 *     is text-based; we extract text-delta + tool-call signals
 *     without hard-binding to the AI SDK's parser (resilient to
 *     SDK minor-version bumps).
 */
async function runPipelineInProcess(q: GoldenQuestion): Promise<{
  reply: string;
  toolCalls: string[];
  durationMs: number;
  pipelineError?: string;
  agentTrace?: AgentTrace;
}> {
  const startedAt = Date.now();
  try {
    const chatRoute = await import("@/app/api/ai/chat/route");
    const POST = chatRoute.POST as (req: Request) => Promise<Response>;
    if (typeof POST !== "function") {
      throw new Error("chat route POST not exported");
    }

    const body = {
      messages: [
        {
          id: `eval-${q.id}-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: q.question }],
        },
      ],
      // mark this turn so persistence + analytics can filter eval traffic
      __evalRun: true,
      __evalQuestionId: q.id,
    };

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-eval-harness": "regression-runner",
      },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        reply: "",
        toolCalls: [],
        durationMs: Date.now() - startedAt,
        pipelineError: `HTTP ${res.status}: ${errBody.slice(0, 200)}`,
      };
    }
    if (!res.body) {
      return {
        reply: "",
        toolCalls: [],
        durationMs: Date.now() - startedAt,
        pipelineError: "no response body",
      };
    }

    const { reply, toolCalls } = await consumeUIStream(res.body);
    return { reply, toolCalls, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      reply: "",
      toolCalls: [],
      durationMs: Date.now() - startedAt,
      pipelineError: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
    };
  }
}

/**
 * Drain a Vercel AI SDK UI message stream and reconstruct the final
 * assistant text + tool calls. Parses defensively · any line that
 * isn't valid JSON is skipped silently (heartbeats, comments, etc.).
 *
 * Exported so tests can feed a synthetic stream without booting the
 * full pipeline.
 */
export async function consumeUIStream(
  stream: ReadableStream<Uint8Array>,
): Promise<{ reply: string; toolCalls: string[] }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  const toolCalls: string[] = [];
  const seenToolCallIds = new Set<string>();

  // v10.0.529.3 M1 fix · track parse-skip ratio so SDK framing drift
  // surfaces. Pre-fix · a `[DONE]`-free SDK update would drop every
  // payload silently and turn the regression suite into "0% pass" ·
  // operator would chase a phantom prod regression for an hour. Now
  // we emit a one-line console warn if >50% of stream lines fail to
  // parse · clearly flags drift vs real regression.
  let parseTotal = 0;
  let parseSkips = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE-style framing · split on double newline OR single newline
      // per the UI message stream format. We try both to be resilient.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!payload || payload === "[DONE]") continue;

        let evt: { type?: string; delta?: string; text?: string; toolName?: string; toolCallId?: string };
        parseTotal += 1;
        try {
          evt = JSON.parse(payload) as typeof evt;
        } catch {
          parseSkips += 1;
          continue;
        }

        // text deltas — accumulate. The SDK has used several names
        // across versions ("text-delta", "text" with delta, etc.);
        // we cover the common shapes.
        if (evt.type === "text-delta" && typeof evt.delta === "string") {
          reply += evt.delta;
        } else if (evt.type === "text" && typeof evt.text === "string") {
          reply += evt.text;
        }

        // tool invocations — capture name once per call id
        if (
          (evt.type === "tool-call" || evt.type === "tool-input-start") &&
          typeof evt.toolName === "string"
        ) {
          const id = evt.toolCallId ?? `${evt.toolName}-${toolCalls.length}`;
          if (!seenToolCallIds.has(id)) {
            seenToolCallIds.add(id);
            toolCalls.push(evt.toolName);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // v10.0.529.3 M1 fix · flag SDK framing drift on the runner side, not
  // inside the hot loop. Only fires when we processed enough lines for
  // the ratio to be meaningful AND the skip rate is >50%.
  if (parseTotal > 10 && parseSkips / parseTotal > 0.5) {
    console.warn(
      `[eval] high stream-parse skip ratio · ${parseSkips}/${parseTotal} ` +
        "lines failed JSON.parse. Likely AI SDK framing drift — verify " +
        "lib/eval/regression-runner.ts's stream framing assumptions before " +
        "treating a low pass-rate as a real regression.",
    );
  }

  return { reply: reply.trim(), toolCalls };
}

// ── Entry point ────────────────────────────────────────────────────

export async function runRegressionSuite(opts: RunOptions = {}): Promise<RegressionReport> {
  const suiteStart = Date.now();
  const all = opts.questionsOverride ?? (await loadGoldenQuestions());

  let queue = all;
  if (opts.category) queue = queue.filter((q) => q.category === opts.category);
  if (typeof opts.limit === "number" && opts.limit > 0) queue = queue.slice(0, opts.limit);

  const runner = opts.runnerOverride ?? runPipelineInProcess;
  const results: QuestionResult[] = [];

  // Sequential — chat pipeline is heavy + we want to be polite to
  // the providers + Neon. 35 questions × ~2-4s each ≈ 70-140s budget.
  for (const q of queue) {
    let runOutcome: Awaited<ReturnType<typeof runner>>;
    try {
      runOutcome = await runner(q);
    } catch (err) {
      runOutcome = {
        reply: "",
        toolCalls: [],
        durationMs: 0,
        pipelineError: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
      };
    }

    const { reply, toolCalls, durationMs, pipelineError, agentTrace } = runOutcome;
    const score = pipelineError
      ? { passed: false, score: 0, failures: [`pipeline error: ${pipelineError}`] }
      : scoreReply(q, reply, toolCalls, agentTrace);

    results.push({
      id: q.id,
      category: q.category,
      passed: score.passed,
      score: score.score,
      failures: score.failures,
      replyPreview: reply.slice(0, 800),
      toolCalls,
      durationMs,
      pipelineError,
    });
  }

  const totalRan = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = totalRan - passed;
  const scoreAvg = totalRan === 0 ? 1 : results.reduce((s, r) => s + r.score, 0) / totalRan;
  const passRate = totalRan === 0 ? 1 : passed / totalRan;

  // worstCategories — count failures by category for quick triage
  const byCategory = new Map<string, { failed: number; total: number }>();
  for (const r of results) {
    const cur = byCategory.get(r.category) ?? { failed: 0, total: 0 };
    cur.total += 1;
    if (!r.passed) cur.failed += 1;
    byCategory.set(r.category, cur);
  }
  const worstCategories = Array.from(byCategory.entries())
    .map(([category, c]) => ({ category, failed: c.failed, total: c.total }))
    .sort((a, b) => b.failed - a.failed);

  // v10.0.528 · categoryStats with passRate per category. Sorted by name
  // for stable diffs across nightly reports.
  const categoryStats: CategoryStats[] = Array.from(byCategory.entries())
    .map(([category, c]) => {
      const passedInCat = c.total - c.failed;
      return {
        category,
        total: c.total,
        passed: passedInCat,
        failed: c.failed,
        passRate: c.total === 0 ? 1 : Math.round((passedInCat / c.total) * 1000) / 1000,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));

  const report: RegressionReport = {
    ranAt: new Date().toISOString(),
    totalRan,
    passed,
    failed,
    scoreAvg: Math.round(scoreAvg * 1000) / 1000,
    passRate: Math.round(passRate * 1000) / 1000,
    perQuestionResults: results,
    durationMs: Date.now() - suiteStart,
    worstCategories,
    categoryStats,
  };

  log.info("regression_suite_done", {
    totalRan,
    passed,
    failed,
    passRate: report.passRate,
    scoreAvg: report.scoreAvg,
    durationMs: report.durationMs,
  });

  return report;
}
