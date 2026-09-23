/**
 * A debug label must name the ROUTE, never a model id.
 *
 * WHY THIS EXISTS. On 2026-09-17 three `DomainRoute` labels named RETIRED
 * models: `code → ollama qwen3-coder` and two `vision → ollama qwen3-vl`.
 * A live census of this Ollama key's 20 servable models found no `qwen3-coder`
 * at all, and `lib/ai/model-liveness.ts` records `qwen3-vl` retired 2026-06-16
 * along with the six-week vision outage it caused.
 *
 * The labels never affected EXECUTION — the model resolves from `taskType`
 * through `resolveProviderModel`. They affected DEBUGGING, which is a label's
 * whole job: a session reading `domain_route label="code → ollama qwen3-coder"`
 * in production logs started filing a code-lane outage.
 *
 * ★ A stale identifier inside a debug label is worse than no identifier,
 *   because a reader treats it as evidence about the running system.
 *
 * ⚠ THE FIRST VERSION OF THIS GUARD DID NOT GUARD ITS OWN INVARIANT. It only
 * rejected PROVIDER words (`ollama`, `openai`, …), so `code → qwen3-coder`
 * — a model id with no provider word — would have passed while the docstring
 * claimed "never a model id". Review caught it. That is this repo's own lens
 * (*does the code have the property its docstring claims?*) failing on the very
 * guard written to stop the defect.
 *
 * Two layers now, because either alone is escapable:
 *   1. every label parsed from source must be in ROUTE_ONLY (exact);
 *   2. no ROUTE_ONLY entry may LOOK like a model id — otherwise the guard is
 *      silenced by pasting the bad label into the allowlist.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "lib/ai/runtime/chat-classifier.ts"),
  "utf8",
);

/** Strip comments — the docstring above the interface legitimately names dead models. */
function stripComments(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function labelsIn(src: string): string[] {
  const out: string[] = [];
  const re = /label:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(stripComments(src))) !== null) out.push(m[1]);
  return out;
}

/** The complete set of legitimate route labels. Adding a domain edits this. */
const ROUTE_ONLY = [
  "code",
  "vision",
  "strategy",
  "marketing",
  "creative",
  "fast-classify",
  "summary",
  "vision (auto-detected from attachment)",
  "general → default",
  "intent-router",
];

/**
 * Structural model-id shape. Model ids carry version digits; route names do
 * not contain a digit at all. Catches `qwen3-coder`, `qwen3-vl`, `glm-5.3`,
 * `deepseek-v4-pro`, `minimax-m3`, `gemma4:31b` without a deny-list of names —
 * a deny-list would need updating on every provider retirement, which is
 * exactly the maintenance that failed here.
 */
const MODEL_ID_SHAPE = /[a-z]+\d|-\d|:\d/i;

describe("DomainRoute debug labels", () => {
  // POSITIVE CONTROL — if the matcher stops finding labels, every assertion
  // below passes vacuously and the guard silently dies.
  it("finds the labels at all", () => {
    const labels = labelsIn(SRC);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    expect(labels).toContain("code");
  });

  it("every label in source is a known route name", () => {
    const unknown = labelsIn(SRC).filter((l) => !ROUTE_ONLY.includes(l));
    expect(unknown).toEqual([]);
  });

  it("no label carries a model-id shape", () => {
    expect(labelsIn(SRC).filter((l) => MODEL_ID_SHAPE.test(l))).toEqual([]);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The exact string that shipped.
  it("CANARY — the label that actually shipped is rejected", () => {
    const shipped = "code → ollama qwen3-coder";
    expect(ROUTE_ONLY).not.toContain(shipped);
    expect(MODEL_ID_SHAPE.test(shipped)).toBe(true);
  });

  // ── CANARY for the defect review found in this guard ─────────────────
  // A model id with NO provider word. The first version of this guard passed
  // it, which is why the provider-word check alone was not the invariant.
  it("CANARY — a model id with no provider word is still rejected", () => {
    for (const bad of ["code → qwen3-coder", "vision → qwen3-vl", "strategy → glm-5.3"]) {
      expect(MODEL_ID_SHAPE.test(bad)).toBe(true);
      expect(ROUTE_ONLY).not.toContain(bad);
    }
  });

  // ── CANARY against silencing the guard ──────────────────────────────
  // Layer 1 alone could be defeated by pasting the bad label into the
  // allowlist. Layer 2 makes the allowlist itself checkable.
  it("CANARY — the allowlist cannot legalise a model id", () => {
    const polluted = [...ROUTE_ONLY, "code → qwen3-coder"];
    expect(polluted.filter((l) => MODEL_ID_SHAPE.test(l))).toEqual(["code → qwen3-coder"]);
  });

  it("accepts every legitimate route label", () => {
    for (const ok of ROUTE_ONLY) expect(MODEL_ID_SHAPE.test(ok)).toBe(false);
  });

  // The docstring above the interface deliberately names the dead models to
  // explain the incident. Scanning raw source would flag it and push the next
  // author to delete the explanation to get green.
  it("ignores model names that appear inside comments", () => {
    const withComment = `/** names ollama qwen3-vl on purpose */\nlabel: "vision",`;
    const found = labelsIn(withComment);
    expect(found).toEqual(["vision"]);
    expect(found.filter((l) => MODEL_ID_SHAPE.test(l))).toEqual([]);
  });
});
