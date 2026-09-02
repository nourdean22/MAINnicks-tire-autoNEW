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
// The same rows reach the model as tool output. A tool under lib/ai/tools
// that reads BrainMemory / chat rows and puts `.content` into its result
// must fence it (searchColdMemory, searchConversations, the customer-360
// notes were all bare until 2026-09-02).
// Keyed on READING the rows, not on a render idiom: searchMemories returned
// whole rows (`{ count, memories }`) and no `.content` interpolation regex
// would ever have seen it. A tool file that reads BrainMemory / chat rows
// either fences what it returns or says, per file, which app-authored
// categories it reads and why they are not ingestion content.
const TOOLS_DIR = join(APP_ROOT, "lib/ai/tools");
const READS_ROWS = /prisma\.(brainMemory|chatMessage)\b|searchColdMemory\(|semanticSearch\(|recallMemoriesForQuery\(|getContextualMemories\(/;
const TOOL_ALLOWLIST: Record<string, string> = {
  "goals.ts": "reads/writes BRAIN_CATEGORIES.WEEKLY_TARGET + undo_token rows the app itself writes · no ingestion category",
  "habits.ts": "counts coach_event rows and reads IDENTITY_SNAPSHOT · app-authored · no content returned from an ingestion category",
  "missions.ts": "reads mission_retro rows the missions engine writes · app-authored",
  "tasks.ts": "reads/writes DECISION_LOG, decision_replay_due, LESSON, IDENTITY_SNAPSHOT, undo_token · all app-authored ledgers",
  "tool-idempotency.ts": "dedupe tokens only · selects expiresAt, never content",
};
const toolFiles = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => {
    const src = readFileSync(join(TOOLS_DIR, f), "utf-8");
    return { file: f, reads: READS_ROWS.test(src), fences: /\bfenceContent\(/.test(src) };
  });

describe("tool-result fencing gate · every lib/ai/tools file that reads memory or chat rows fences what it returns, or explains", () => {
  it("enumerates the tool files (sanity)", () => {
    expect(toolFiles.length).toBeGreaterThanOrEqual(6);
    const readers = toolFiles.filter((t) => t.reads).map((t) => t.file);
    expect(readers, "the two memory-returning tool files must be detected as readers").toEqual(expect.arrayContaining(["brain.ts", "business.ts"]));
  });

  it("no reader is unfenced unless allowlisted with a per-category reason", () => {
    const bare = toolFiles.filter((t) => t.reads && !t.fences && !(t.file in TOOL_ALLOWLIST)).map((t) => t.file);
    expect(bare, `tool files reading BrainMemory / chat rows with no <tool_data> fence — fence the returned content, or allowlist with the categories they read:\n${bare.join("\n")}`).toEqual([]);
  });

  it("inverse · an allowlist entry that stops reading rows, or starts fencing, must leave the list", () => {
    const stale = Object.keys(TOOL_ALLOWLIST).filter((f) => {
      const t = toolFiles.find((x) => x.file === f);
      return !t || !t.reads || t.fences;
    });
    expect(stale, `stale TOOL_ALLOWLIST entries:\n${stale.join("\n")}`).toEqual([]);
    for (const [f, reason] of Object.entries(TOOL_ALLOWLIST)) expect(reason.length, `${f} needs a real reason`).toBeGreaterThan(20);
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
