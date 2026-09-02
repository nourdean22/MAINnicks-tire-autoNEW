/**
 * tests/ai/prompt-block-fencing-gate.test.ts · 2026-09-02 · S-1 completion
 *
 * The guardian-registry-drift pattern on the system-prompt assembly: ENUMERATE
 * the producers, ASSERT the subject, keep an INVERSE check. brain-context.ts
 * imports ~30 modules and splices their output into the chat system prompt.
 * Any of them that interpolates stored `.content` (BrainMemory rows, prior
 * chat turns) into that text is a door external content can take into the
 * prompt — the audit's S-1 named one (contextual-recall); a self-review found
 * four more that shipped bare AFTER S-1 was "fixed". This gate makes the set
 * explicit: interpolate `.content` → call fenceContent, or be allowlisted
 * here with a reason that a reader can check.
 *
 * Static by design: it enumerates call sites, which the behavioural test in
 * brain-context-fencing.test.ts cannot do (it asserts the blocks that fire).
 * Together: this file says "every producer is fenced or explained", that file
 * says "the fences actually reach the prompt, closed".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONSUMER = join(APP_ROOT, "lib/services/chat/brain-context.ts");

/**
 * Modules that interpolate `.content` but deliberately do NOT fence. Each
 * entry needs a reason a reviewer can verify by opening the file. The inverse
 * check below fails if an entry stops interpolating (stale) or starts fencing
 * (then it no longer belongs here).
 */
const ALLOWLIST: Record<string, string> = {
  "@/lib/ai/predictive-prefetch":
    "FORECAST MEMORY branch serialises system-authored financial_forecast rows as JSON data · not an ingestion category · revisit if a prefetch intent ever reads gmail/drive/review categories",
  "@/lib/brain/cross-system-nudge":
    "renders the overnight belief-refresh line · LLM-derived belief text, not raw ingested content",
  "@/lib/brain/conversation-memory":
    "cross-session thread text is fenced by its consumer at brain-context.ts (cross_session, #2062) before slicing",
  "@/lib/brain/identity-snapshot":
    "renders numeric identity axes (value/100) only · no stored free text reaches the prompt",
  "@/lib/brain/skill-extractor":
    "skill protocols are instructions BY DESIGN — fencing them as data would defeat them; the poisoning path is captureSkillFromSource, which is owner-gated",
  "@/lib/ai/greene-message-matcher":
    "reads the app-seeded greene_law corpus · static curated text, not operator or third-party input",
  "@/lib/ai/dark-psychology-matcher":
    "reads the app-seeded dark_psychology corpus · static curated text, not operator or third-party input",
};

/**
 * Keyed on READING memory / chat rows, not on a render idiom. The #2064 review
 * showed why: belief-harvester renders `b.statement`, qualitative-identity
 * renders `e.text`, searchMemories returned whole rows — a `.content` regex
 * saw none of them. If a module the consumer imports reads the rows, it
 * either fences what it renders or explains here why the rows it reads can
 * carry no stored free text worth fencing.
 */
const INTERPOLATES = /prisma\.(brainMemory|chatMessage)\b|searchColdMemory\(|semanticSearch\(|recallMemoriesForQuery\(|getContextualMemories\(|brainMemory\.(recall|search|get|list)/;

function importedLibModules(): string[] {
  const src = readFileSync(CONSUMER, "utf-8");
  const specs = new Set<string>();
  for (const m of src.matchAll(/import\("(@\/lib\/[^"]+)"\)|from "(@\/lib\/[^"]+)"/g)) specs.add(m[1] ?? m[2]);
  return [...specs].sort();
}

function resolveModule(spec: string): string | null {
  const base = join(APP_ROOT, spec.slice(2));
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

const modules = importedLibModules().map((spec) => {
  const file = resolveModule(spec);
  const src = file ? readFileSync(file, "utf-8") : "";
  return { spec, file, interpolates: INTERPOLATES.test(src), fences: /\bfenceContent\(/.test(src) };
});

// ── the other door: TOOL RESULTS ──────────────────────────────────────────
// The same rows reach the model as tool output. Analysed PER TOOL, not per
// file (#2065 review): a file-level "contains fenceContent" let the first
// fenced tool in the 1,600-line brain.ts vouch for every other tool in it,
// while surfaceAntiPatterns and getHabitRevenueCorrelation still returned raw
// content. Each `name: tool({ ... })` block is its own subject: if it reads
// BrainMemory / chat rows AND touches `.content`, it must call fenceContent
// inside that block, or be allowlisted by name with the categories it reads.
// searchMemories returned WHOLE rows, so the key is reading + touching
// content, never a render idiom.
const TOOLS_DIR = join(APP_ROOT, "lib/ai/tools");
const READS_ROWS = /prisma\.(brainMemory|chatMessage)\b|searchColdMemory\(|semanticSearch\(|recallMemoriesForQuery\(|getContextualMemories\(/;

export interface ToolAnalysis {
  file: string;
  tool: string;
  reads: boolean;
  touchesContent: boolean;
  fenced: boolean;
}

/**
 * Pure, so the mutation canary below can run it on a doctored source string.
 * Splits a tool file on its `  name: tool({` block starts (the exported tools
 * object literal); each block runs to the next start or EOF.
 */
export function analyzeToolSource(file: string, src: string): ToolAnalysis[] {
  const lines = src.split("\n");
  const starts: Array<[number, string]> = [];
  lines.forEach((l, i) => {
    const m = l.match(/^  ([a-zA-Z]+): tool\(\{/);
    if (m) starts.push([i, m[1]]);
  });
  return starts.map(([i, tool], k) => {
    const seg = lines.slice(i, k + 1 < starts.length ? starts[k + 1][0] : lines.length).join("\n");
    return { file, tool, reads: READS_ROWS.test(seg), touchesContent: /\.content\b/.test(seg), fenced: /\bfenceContent\(/.test(seg) };
  });
}

/** Per-TOOL allowlist: reads rows + touches content, deliberately unfenced, with the categories it reads. */
const TOOL_ALLOWLIST: Record<string, string> = {
  "goals.ts:getWeeklyTargets": "WEEKLY_TARGET rows are numbers the operator set via setWeeklyTargets · app-authored ledger",
  "habits.ts:weeklyReview": "IDENTITY_SNAPSHOT (numeric axes) + coach_event rows the app writes · no stored free text from an ingestion category",
  "habits.ts:analyzeWeek": "IDENTITY_SNAPSHOT (numeric axes) + coach_event rows the app writes · no stored free text from an ingestion category",
  "tasks.ts:getDecisionsDueForReplay": "decision_replay_due rows hold decisions Nour journaled himself via journalDecision · operator-authored",
  "tasks.ts:decisionPreFlight": "IDENTITY_SNAPSHOT numeric axes only",
  "tasks.ts:dailyPulse": "IDENTITY_SNAPSHOT numeric axes only",
  "tasks.ts:endOfDay": "IDENTITY_SNAPSHOT numeric axes only",
};

const toolAnalyses: ToolAnalysis[] = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .flatMap((f) => analyzeToolSource(f, readFileSync(join(TOOLS_DIR, f), "utf-8")));
const toolKey = (t: ToolAnalysis) => `${t.file}:${t.tool}`;
const subjects = toolAnalyses.filter((t) => t.reads && t.touchesContent);

describe("tool-result fencing gate · every TOOL that reads memory or chat rows and touches content fences what it returns, or explains", () => {
  it("enumerates the tools (sanity · the splitter must find the real blocks)", () => {
    expect(toolAnalyses.length).toBeGreaterThanOrEqual(150);
    expect(subjects.length).toBeGreaterThanOrEqual(12);
    for (const k of ["brain.ts:searchMemories", "brain.ts:searchColdMemory", "brain.ts:searchConversations", "brain.ts:surfaceAntiPatterns", "brain.ts:getHabitRevenueCorrelation", "business.ts:findCustomer", "missions.ts:getMissionRetros"]) {
      expect(subjects.map(toolKey), `${k} must be a subject`).toContain(k);
    }
  });

  it("no subject tool is unfenced unless allowlisted by name with the categories it reads", () => {
    const bare = subjects.filter((t) => !t.fenced && !(toolKey(t) in TOOL_ALLOWLIST)).map(toolKey);
    expect(bare, `tools that read BrainMemory / chat rows and touch .content with no <tool_data> fence inside their own block:\n${bare.join("\n")}`).toEqual([]);
  });

  it("inverse · an allowlist entry that is no longer a subject, or now fences, must leave the list", () => {
    const stale = Object.keys(TOOL_ALLOWLIST).filter((k) => {
      const t = toolAnalyses.find((x) => toolKey(x) === k);
      return !t || !(t.reads && t.touchesContent) || t.fenced;
    });
    expect(stale, `stale TOOL_ALLOWLIST entries:\n${stale.join("\n")}`).toEqual([]);
    for (const [k, reason] of Object.entries(TOOL_ALLOWLIST)) expect(reason.length, `${k} needs a real reason`).toBeGreaterThan(20);
  });

  it("mutation canary · stripping ONE tool's fence makes exactly that tool bare (the gate sees per tool, not per file)", () => {
    const src = readFileSync(join(TOOLS_DIR, "brain.ts"), "utf-8");
    const before = analyzeToolSource("brain.ts", src);
    expect(before.find((t) => t.tool === "searchColdMemory")?.fenced).toBe(true);
    const mutated = src.replace('fenceContent("searchColdMemory", "memory_recall", m.content.slice(0, 600))', "m.content.slice(0, 600)");
    expect(mutated).not.toBe(src);
    const after = analyzeToolSource("brain.ts", mutated);
    const bareAfter = after.filter((t) => t.reads && t.touchesContent && !t.fenced).map((t) => t.tool);
    expect(bareAfter).toContain("searchColdMemory");
    // and ONLY that one changed — the other fenced tools in the same file still count as fenced
    expect(after.find((t) => t.tool === "searchMemories")?.fenced).toBe(true);
    expect(after.find((t) => t.tool === "searchConversations")?.fenced).toBe(true);
  });
});

describe("prompt-block fencing gate · every brain-context producer that renders stored content is fenced or explained", () => {
  it("enumerates the producers (sanity · the scan must not silently match nothing)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(25);
    const unresolved = modules.filter((m) => !m.file).map((m) => m.spec);
    expect(unresolved, "brain-context imports this gate cannot resolve").toEqual([]);
    // The four producers S-1 + its completion fenced must show up as such —
    // otherwise the interpolation regex no longer matches this codebase's idiom.
    const fenced = modules.filter((m) => m.interpolates && m.fences).map((m) => m.spec);
    for (const spec of [
      "@/lib/brain/contextual-recall", "@/lib/brain/memory-recall", "@/lib/brain/anticipatory-recall", "@/lib/brain/chat-recall",
      "@/lib/brain/belief-harvester", "@/lib/brain/qualitative-identity", "@/lib/brain/ghost-nick", "@/lib/brain/anticipated-questions",
      "@/lib/brain/contradiction-injector", "@/lib/brain/session-distiller", "@/lib/brain/objection-injector",
    ]) {
      expect(fenced, `${spec} must both read memory rows and fence what it renders`).toContain(spec);
    }
  });

  it("no producer that reads memory or chat rows renders without fenceContent, unless allowlisted with a reason", () => {
    const bare = modules.filter((m) => m.interpolates && !m.fences && !(m.spec in ALLOWLIST)).map((m) => m.spec);
    expect(
      bare,
      `brain-context producers that read BrainMemory / chat rows and render with no <tool_data> fence — fence at source (see contextual-recall's fenceRecallBlock) or allowlist WITH a reason a reviewer can check:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("inverse · an allowlist entry that no longer interpolates, or now fences, must leave the list", () => {
    const stale = Object.keys(ALLOWLIST).filter((spec) => {
      const m = modules.find((x) => x.spec === spec);
      return !m || !m.interpolates || m.fences;
    });
    expect(stale, `stale ALLOWLIST entries (not imported / no longer interpolating / now fenced):\n${stale.join("\n")}`).toEqual([]);
    for (const [spec, reason] of Object.entries(ALLOWLIST)) expect(reason.length, `${spec} needs a real reason`).toBeGreaterThan(20);
  });
});
