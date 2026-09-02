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
import { existsSync, readFileSync } from "node:fs";
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
  "@/lib/ai/context-reranker":
    "embeds block text to score it; renders nothing into the prompt",
  "@/lib/ai/predictive-prefetch":
    "FORECAST MEMORY branch serialises system-authored financial_forecast rows as JSON data · not an ingestion category · revisit if a prefetch intent ever reads gmail/drive/review categories",
  "@/lib/brain/cross-system-nudge":
    "renders the overnight belief-refresh line · LLM-derived belief text, not raw ingested content",
  "@/lib/brain/session-distiller":
    "interpolates chat turns into the DISTILLATION model prompt, not into the chat system prompt; its concerns block renders derived summaries",
  "@/lib/brain/conversation-memory":
    "cross-session thread text is fenced by its consumer at brain-context.ts (cross_session, #2062) before slicing",
};

/** `${x.content}` / `${x.content.slice(...)}` / `.content.slice(0` — the render idioms in this tree. */
const INTERPOLATES = /\$\{[^}]*\.content(\.slice\([^)]*\))?\}|\.content\.slice\(0/;

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

describe("prompt-block fencing gate · every brain-context producer that renders stored content is fenced or explained", () => {
  it("enumerates the producers (sanity · the scan must not silently match nothing)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(25);
    const unresolved = modules.filter((m) => !m.file).map((m) => m.spec);
    expect(unresolved, "brain-context imports this gate cannot resolve").toEqual([]);
    // The four producers S-1 + its completion fenced must show up as such —
    // otherwise the interpolation regex no longer matches this codebase's idiom.
    const fenced = modules.filter((m) => m.interpolates && m.fences).map((m) => m.spec);
    for (const spec of ["@/lib/brain/contextual-recall", "@/lib/brain/memory-recall", "@/lib/brain/anticipatory-recall", "@/lib/brain/chat-recall"]) {
      expect(fenced, `${spec} must both interpolate .content and fence it`).toContain(spec);
    }
  });

  it("no producer interpolates stored content into the prompt without fenceContent, unless allowlisted with a reason", () => {
    const bare = modules.filter((m) => m.interpolates && !m.fences && !(m.spec in ALLOWLIST)).map((m) => m.spec);
    expect(
      bare,
      `brain-context producers that render .content without a <tool_data> fence — fence at source (see contextual-recall's fenceRecallBlock) or allowlist WITH a reason:\n${bare.join("\n")}`,
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
