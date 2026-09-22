/**
 * tests/eval/run-suite.ts · Nick regression eval suite runner (task #14).
 *
 * Orchestrates the LLM-as-judge regression suite. Two modes by design:
 *
 *   · dry-run (default) · loads + validates every scenario JSON against
 *     the Zod schema · prints a category breakdown · NO LLM calls.
 *     Used by the contract test and any CI run.
 *
 *   · --live · loads scenarios, calls Nick for each (via aiChat through
 *     the provider chain), judges via tests/eval/judge.ts, writes a
 *     timestamped report to tests/eval/reports/<ISO>.json. Operator
 *     runs this manually because it incurs $ on the provider chain.
 *
 * Flags:
 *   · --live              · enable live mode (default is dry-run)
 *   · --dry-run           · explicit dry-run (default)
 *   · --filter=<category> · only run scenarios of this category
 *   · --out=<path>        · override the report output path (live only)
 *   · --tools             · with --live: run `requires-tools` scenarios through the
 *                           STUBBED tool replay (tests/eval/tool-replay.ts) instead of
 *                           skipping them — tools attached with production schemas,
 *                           calls recorded, nothing executed, the judge sees the trace
 *
 * Exit codes:
 *   · 0 · suite ran cleanly (dry-run validated OR live-run completed)
 *   · 1 · a scenario JSON failed schema validation
 *   · 2 · live-run had ≥1 flagged scenario (composite < 6.0 OR errored)
 *
 * Skips (live mode · 2026-09-22):
 *   · a scenario tagged `requires-tools` (types.ts REQUIRES_TOOLS_TAG) is
 *     SKIPPED with an explicit reason and counted in summary.skipped, never
 *     scored: its dominant criterion needs a real tool action and aiChat has
 *     no tool support, so a score would grade the runner's limit as a
 *     product regression. Skips never affect the exit code.
 *
 * Cost notes (live mode):
 *   · Each scenario · 1 Nick call + 1 judge call · ~$0.0002 with cheap
 *     provider chain · 8 scenarios · roughly $0.002 per suite run.
 *   · Provider chain honored · Venice + Ollama Cloud Pro first per the
 *     ai_policy matrix · OpenAI/Anthropic only on fallback.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { judgeResponse } from "./judge";
import { renderToolTrace } from "./tool-replay";
import {
  type JudgeResult,
  type Scenario,
  type ScenarioCategory,
  type SkippedScenario,
  type SuiteReport,
  type SuiteSummary,
  REQUIRES_TOOLS_TAG,
  requiresToolRunner,
  scenarioCategoryValues,
  scenarioSchema,
} from "./types";

/**
 * Why a `requires-tools` scenario is not scored on the aiChat path. Stated once
 * so the report, the stdout line and the test agree on the wording.
 */
export const REQUIRES_TOOLS_SKIP_REASON =
  `tagged ${REQUIRES_TOOLS_TAG}: needs a tool-capable runner — --live replays through aiChat, which has no tool support; run with --live --tools for the stubbed tool replay`;

// ── CLI args (zero-dep parsing · 2 flags, 1 keyword pair) ────────────

interface ParsedArgs {
  live: boolean;
  filter: ScenarioCategory | null;
  outPath: string | null;
  /** `--tools` · replay requires-tools scenarios with stubbed execution (live only). */
  tools: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let live = false;
  let filter: ScenarioCategory | null = null;
  let outPath: string | null = null;
  let tools = false;

  for (const arg of argv) {
    if (arg === "--live") live = true;
    else if (arg === "--dry-run") live = false;
    else if (arg === "--tools") tools = true;
    else if (arg.startsWith("--filter=")) {
      const candidate = arg.slice("--filter=".length);
      if ((scenarioCategoryValues as readonly string[]).includes(candidate)) {
        filter = candidate as ScenarioCategory;
      } else {
        throw new Error(
          `--filter must be one of: ${scenarioCategoryValues.join(", ")} (got: ${candidate})`,
        );
      }
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--") && arg !== "--help" && arg !== "-h") {
      throw new Error(`unknown flag: ${arg}`);
    }
  }

  return { live, filter, outPath, tools };
}

// ── Scenario loading ─────────────────────────────────────────────────

const SCENARIOS_DIR = path.join(process.cwd(), "tests", "eval", "scenarios");

interface LoadResult {
  scenarios: Scenario[];
  invalid: Array<{ file: string; error: string }>;
}

export async function loadScenarios(dir: string = SCENARIOS_DIR): Promise<LoadResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    throw new Error(
      `failed to read scenarios dir ${dir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  const scenarios: Scenario[] = [];
  const invalid: Array<{ file: string; error: string }> = [];

  for (const file of jsonFiles) {
    const full = path.join(dir, file);
    try {
      const raw = await fs.readFile(full, "utf8");
      const json: unknown = JSON.parse(raw);
      const parsed = scenarioSchema.safeParse(json);
      if (parsed.success) {
        scenarios.push(parsed.data);
      } else {
        invalid.push({
          file,
          error: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" · "),
        });
      }
    } catch (err) {
      invalid.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scenarios, invalid };
}

// ── Nick invocation (live mode only) ─────────────────────────────────

/**
 * Call Nick with a scenario's message sequence. Uses the same provider
 * chain (`aiChat`) the production chat route falls back to · this is
 * the cheapest, most provider-agnostic way to replay a scenario
 * without booting Next.js' full route + auth stack.
 *
 * Trade-off · this isn't the FULL chat pipeline (no tool calls, no
 * memory recall, no skills injection). It's "what Nick's text
 * generation looks like in isolation" · same abstraction the V1↔V2
 * comparator uses (lib/ai/judge-eval/replay.ts). Good enough for
 * detecting prompt/model regressions. NOTE: pipeline-level smoke used to
 * be covered by lib/eval/regression-runner.ts, deleted 2026-08-09 as dead
 * code — nothing covers that layer today. A scenario whose criteria NEED a
 * tool action carries REQUIRES_TOOLS_TAG and never reaches this function:
 * runLive skips it with REQUIRES_TOOLS_SKIP_REASON.
 */
/**
 * The system prompt a replay sends — shared by the aiChat path and the stubbed
 * tool replay so both grade Nick against the same instructions.
 *
 * Built the same way the chat route does, but with no live memory recall
 * (we're replaying scenarios, not mutating brain state). 2026-09-22 · the tier
 * comes from the SAME classifier the route uses (app/api/ai/chat/route.ts →
 * detectTopicTier(userContent)). From 2026-05-23 until today this passed the
 * literal "lite" — not a TopicTier at all ("core" | "business" | "personal" |
 * "strategy" | "full"); tests/ is excluded from tsc, so nothing said so.
 * Downstream an unknown tier fails the wantsKnowledge check in
 * appendBusinessKnowledgeLayer, so every live replay ran WITHOUT the
 * business-knowledge layer production attaches to business asks: live reports
 * before this date graded a thinner prompt than production's.
 *
 * 2026-08-18 · fairness fix: contextSetup used to be shown ONLY to the judge,
 * so Nick was graded against constraints he never saw — witnessed on
 * persona-obedience-yes-executes, where "no search tool is attached" was
 * judge-visible while Nick replied "We'll search" in good faith. Environment
 * constraints reach Nick too.
 */
export async function buildReplaySystemPrompt(scenario: Scenario): Promise<string> {
  const { buildSystemPromptUncached, detectTopicTier } = await import("@/lib/ai/system-prompt");
  const lastUserContent =
    scenario.input.messages[scenario.input.messages.length - 1]?.content ?? "";
  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPromptUncached(
      detectTopicTier(lastUserContent),
      lastUserContent,
    );
  } catch {
    // Fall back to a minimal voice marker · keeps the eval running
    // even when the system-prompt builder errors (which has happened
    // historically when brain DB is unreachable).
    systemPrompt =
      "You are Nick · an operator-grade personal-OS AI. Be direct, terse, evidence-grounded. No corporate filler.";
  }
  const contextLines = scenario.contextSetup?.length
    ? `\n\n## Replay environment (for this conversation)\n${scenario.contextSetup.map((s) => `- ${s}`).join("\n")}`
    : "";
  return systemPrompt + contextLines;
}

/**
 * 2026-08-18 · calibration lever, same single-source layer the production
 * persist path runs (lib/ai/chat/calibration-enforcer): forecast-shaped ask +
 * no likelihood band -> elicit-or-notice. Fail-open — the eval grades whatever
 * the layer produced or didn't. Shared by both replay paths.
 */
async function applyCalibration(scenario: Scenario, text: string): Promise<string> {
  try {
    const { enforceCalibration } = await import("@/lib/ai/chat/calibration-enforcer");
    const lastUser = [...scenario.input.messages].reverse().find((m) => m.role === "user");
    const calibrated = await enforceCalibration(lastUser?.content ?? "", text);
    return calibrated.text;
  } catch {
    return text;
  }
}

async function callNick(scenario: Scenario): Promise<{ response: string; error: string | null }> {
  const { aiChat } = await import("@/lib/ai/provider");

  // 2026-08-18 · replay the SYSTEM, not just the model. Production chat
  // runs deterministic interceptors before any model call; the one that
  // matters for this suite is re-delivery ("app bugged, retry" →
  // re-serve the stored last assistant text verbatim, added after the
  // prompt-rule approach measurably failed the retry scenario). Same
  // exported classifier as production — single source, no drift.
  {
    const { isRedeliveryRequest } = await import("@/lib/ai/chat/redelivery");
    const msgs = scenario.input.messages;
    const lastUser = msgs[msgs.length - 1];
    const priorAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (
      lastUser?.role === "user" &&
      priorAssistant &&
      isRedeliveryRequest(lastUser.content)
    ) {
      return { response: priorAssistant.content, error: null };
    }
  }

  const systemPrompt = await buildReplaySystemPrompt(scenario);

  try {
    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        ...scenario.input.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      "reason",
    );
    // 2026-08-18 · aiChat NEVER throws on total provider failure — it
    // returns a SENTINEL (repo gotcha: check result.provider ===
    // "emergency" | "none"). Without this check the judge scores the
    // outage text against the scenario criteria: witnessed on the first
    // live run, where persona-obedience-yes-executes "passed" 7.9/10
    // with Nick's reply being "I'm having trouble connecting to my AI
    // providers". A transient infra failure must be an ERRORED
    // scenario (re-run covers it), never a fake pass or fail.
    if (result.provider === "emergency" || result.provider === "none") {
      return {
        response: "",
        error: `provider sentinel (${result.provider}) — transient chain failure, not a Nick reply`,
      };
    }
    // The suite replays the system, not the bare model.
    const text = await applyCalibration(scenario, (result.content ?? "").trim());
    return {
      response: text,
      error: null,
    };
  } catch (err) {
    return {
      response: "",
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  }
}

// ── Summary computation ──────────────────────────────────────────────

function summarize(
  totalScenarios: number,
  results: JudgeResult[],
  skipped: SkippedScenario[] = [],
  toolRuns = 0,
): SuiteSummary {
  const errored = results.filter((r) => r.error !== null).length;
  const flagged = results.filter((r) => r.error === null && r.flagForReview).length;
  const passing = results.filter((r) => r.error === null && !r.flagForReview).length;
  const compositeMean =
    results.length === 0 || results.length === errored
      ? 0
      : results
          .filter((r) => r.error === null)
          .reduce((sum, r) => sum + r.composite, 0) / Math.max(1, results.length - errored);

  return {
    totalScenarios,
    ranScenarios: results.length,
    passing,
    flagged,
    errored,
    skipped: skipped.length,
    toolRuns,
    meanComposite: Math.round(compositeMean * 10) / 10,
  };
}

// ── Modes ────────────────────────────────────────────────────────────

interface RunInput {
  args: ParsedArgs;
  scenariosDir?: string;
}

export async function runDryRun(input: RunInput): Promise<SuiteReport> {
  const startedAt = Date.now();
  const { scenarios, invalid } = await loadScenarios(input.scenariosDir);

  if (invalid.length > 0) {
    const summary = invalid.map((i) => `  · ${i.file}: ${i.error}`).join("\n");
    throw new Error(`${invalid.length} scenario(s) failed schema validation:\n${summary}`);
  }

  const filtered = input.args.filter
    ? scenarios.filter((s) => s.category === input.args.filter)
    : scenarios;

  return {
    ranAt: new Date(startedAt).toISOString(),
    mode: "dry-run",
    filter: input.args.filter,
    results: [],
    skipped: [],
    toolReplay: false,
    summary: summarize(filtered.length, []),
    durationMs: Date.now() - startedAt,
  };
}

export async function runLive(input: RunInput): Promise<SuiteReport> {
  const startedAt = Date.now();
  const { scenarios, invalid } = await loadScenarios(input.scenariosDir);

  if (invalid.length > 0) {
    const summary = invalid.map((i) => `  · ${i.file}: ${i.error}`).join("\n");
    throw new Error(`${invalid.length} scenario(s) failed schema validation:\n${summary}`);
  }

  const filtered = input.args.filter
    ? scenarios.filter((s) => s.category === input.args.filter)
    : scenarios;

  const results: JudgeResult[] = [];
  const skipped: SkippedScenario[] = [];
  let toolRuns = 0;

  for (const scenario of filtered) {
    const scenarioStart = Date.now();
    process.stdout.write(`  · ${scenario.id.padEnd(36)} `);

    // 2026-09-22 · a tool-dependent scenario cannot be satisfied by the aiChat
    // path (REQUIRES_TOOLS_SKIP_REASON). Decide BEFORE calling Nick: no
    // provider spend, no impossible score, no fake "flagged". With --tools it
    // goes through the stubbed tool replay instead — tools attached, calls
    // recorded, nothing executed, the judge sees the trace.
    if (requiresToolRunner(scenario)) {
      if (!input.args.tools) {
        skipped.push({ scenarioId: scenario.id, reason: REQUIRES_TOOLS_SKIP_REASON });
        process.stdout.write(`SKIP (${REQUIRES_TOOLS_TAG})\n`);
        continue;
      }
      const { callNickWithTools } = await import("./tool-replay");
      const systemPrompt = await buildReplaySystemPrompt(scenario);
      const replay = await callNickWithTools(scenario, systemPrompt);
      if (replay.error) {
        results.push({
          scenarioId: scenario.id,
          responsePreview: "",
          criterionScores: [],
          composite: 0,
          flagForReview: true,
          judgedBy: "n/a",
          durationMs: Date.now() - scenarioStart,
          error: `nick(tools): ${replay.error}`,
          toolCalls: replay.toolCalls,
        });
        process.stdout.write("ERR (nick · tool replay)\n");
        continue;
      }
      const text = await applyCalibration(scenario, replay.response);
      const trace = renderToolTrace(replay.toolCalls);
      const judged = await judgeResponse(scenario, trace ? `${trace}\n\n${text}` : text, scenarioStart);
      results.push({ ...judged, toolCalls: replay.toolCalls });
      toolRuns += 1;
      if (judged.error) {
        process.stdout.write(`ERR (judge)\n`);
      } else {
        const flag = judged.flagForReview ? " [FLAGGED]" : "";
        process.stdout.write(
          `${judged.composite.toFixed(1)}/10${flag} · ${replay.toolCalls.length} tool call(s), stubbed\n`,
        );
      }
      continue;
    }

    const nick = await callNick(scenario);
    if (nick.error) {
      results.push({
        scenarioId: scenario.id,
        responsePreview: "",
        criterionScores: [],
        composite: 0,
        flagForReview: true,
        judgedBy: "n/a",
        durationMs: Date.now() - scenarioStart,
        error: `nick: ${nick.error}`,
      });
      process.stdout.write("ERR (nick)\n");
      continue;
    }

    const judged = await judgeResponse(scenario, nick.response, scenarioStart);
    results.push(judged);

    if (judged.error) {
      process.stdout.write(`ERR (judge)\n`);
    } else {
      const flag = judged.flagForReview ? " [FLAGGED]" : "";
      process.stdout.write(`${judged.composite.toFixed(1)}/10${flag}\n`);
    }
  }

  return {
    ranAt: new Date(startedAt).toISOString(),
    mode: "live",
    filter: input.args.filter,
    results,
    skipped,
    toolReplay: input.args.tools,
    summary: summarize(filtered.length, results, skipped, toolRuns),
    durationMs: Date.now() - startedAt,
  };
}

// ── Reporting ────────────────────────────────────────────────────────

export function formatSummaryLine(report: SuiteReport): string {
  const { summary } = report;
  if (report.mode === "dry-run") {
    return `dry-run · ${summary.totalScenarios} scenario(s) validated${
      report.filter ? ` (filter: ${report.filter})` : ""
    } · ${report.durationMs}ms`;
  }
  const toolNote = report.toolReplay ? ` · ${summary.toolRuns} via stubbed tool replay` : "";
  return `live · ${summary.ranScenarios}/${summary.totalScenarios} ran · ${summary.passing} passing · ${summary.flagged} flagged · ${summary.errored} errored · ${summary.skipped} skipped (${REQUIRES_TOOLS_TAG})${toolNote} · mean ${summary.meanComposite}/10 · ${report.durationMs}ms`;
}

function formatCategoryBreakdown(scenarios: Scenario[], filter: ScenarioCategory | null): string {
  const counts = new Map<string, number>();
  for (const s of scenarios) {
    if (filter && s.category !== filter) continue;
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, n]) => `  · ${cat.padEnd(12)} ${n}`)
    .join("\n");
}

async function writeReport(report: SuiteReport, outPath: string): Promise<void> {
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
}

// ── Entrypoint ───────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (!args.live) {
    // Dry-run · print + exit
    try {
      const report = await runDryRun({ args });
      const { scenarios } = await loadScenarios();
      // Surface the tool-gated subset here too, so an operator reading the
      // free dry-run knows how many scenarios the paid --live run will skip.
      const gated = scenarios.filter(
        (s) => (!args.filter || s.category === args.filter) && requiresToolRunner(s),
      ).length;
      process.stdout.write(`\nNick eval suite · dry-run\n`);
      process.stdout.write(`${formatCategoryBreakdown(scenarios, args.filter)}\n`);
      process.stdout.write(
        `  · ${gated} tagged ${REQUIRES_TOOLS_TAG} · skipped in --live (aiChat has no tools); scored with --live --tools (stubbed execution)\n\n`,
      );
      process.stdout.write(`${formatSummaryLine(report)}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  // Live mode
  process.stdout.write(
    `\nNick eval suite · LIVE (provider chain will be called${args.tools ? "; requires-tools scenarios via stubbed tool replay — nothing is executed" : ""})\n\n`,
  );
  let report: SuiteReport;
  try {
    report = await runLive({ args });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Write report (default path · tests/eval/reports/<timestamp>.json)
  const defaultOut = path.join(
    process.cwd(),
    "tests",
    "eval",
    "reports",
    `${report.ranAt.replace(/[:.]/g, "-")}.json`,
  );
  const outPath = args.outPath ?? defaultOut;
  await writeReport(report, outPath);

  process.stdout.write(`\n${formatSummaryLine(report)}\n`);
  process.stdout.write(`report · ${path.relative(process.cwd(), outPath)}\n`);

  // Exit 2 if any scenario flagged · so CI / scheduled runs can react
  return report.summary.flagged > 0 || report.summary.errored > 0 ? 2 : 0;
}

// Run when invoked directly (not when imported by tests).
// `import.meta.url` check works under tsx + Node ESM resolution.
const isDirectInvocation =
  typeof process !== "undefined" &&
  typeof import.meta.url === "string" &&
  import.meta.url.startsWith("file://") &&
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]));

if (isDirectInvocation) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
