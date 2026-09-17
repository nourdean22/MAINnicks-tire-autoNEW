/**
 * A debug label must not name a provider model.
 *
 * WHY THIS EXISTS. On 2026-09-17 three `DomainRoute` labels named RETIRED
 * models: `code → ollama qwen3-coder` and two `vision → ollama qwen3-vl`.
 * A live census of this Ollama key's 20 servable models found no `qwen3-coder`
 * at all, bare or tagged, and `lib/ai/model-liveness.ts` records `qwen3-vl`
 * being retired on 2026-06-16 along with the six-week vision outage it caused.
 *
 * The labels never affected EXECUTION — the model is resolved from `taskType`
 * through `resolveProviderModel`, and `provider.try` logs the id that actually
 * served the turn. They affected DEBUGGING, which is the whole point of a
 * label: a session reading `domain_route label="code → ollama qwen3-coder"` in
 * production logs started filing a code-lane outage before discovering the
 * label carries no routing power.
 *
 * ★ A stale identifier inside a debug label is worse than no identifier,
 *   because a reader treats it as evidence about the running system.
 *
 * Model ids drift without warning; `taskType` does not. So the invariant is
 * structural rather than a list of dead names — a deny-list of retired models
 * would need updating every time a provider retires one, which is exactly the
 * maintenance that failed here.
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

const LABEL = /label:\s*"([^"]*)"/g;

function labelsIn(src: string): string[] {
  const out: string[] = [];
  const re = new RegExp(LABEL.source, "g");
  let m;
  while ((m = re.exec(stripComments(src))) !== null) out.push(m[1]);
  return out;
}

/** Provider names are the drift vector: naming one invites naming its model. */
const PROVIDER = /\b(ollama|openai|anthropic|gemini|openrouter|groq|venice)\b/i;

describe("DomainRoute debug labels", () => {
  // POSITIVE CONTROL — if the matcher stops finding labels, every assertion
  // below passes vacuously and the guard silently dies.
  it("finds the labels at all", () => {
    const labels = labelsIn(SRC);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    expect(labels).toContain("code");
  });

  it("no label names a provider", () => {
    const offenders = labelsIn(SRC).filter((l) => PROVIDER.test(l));
    expect(offenders).toEqual([]);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The exact string that shipped. If this stops failing, the guard is broken.
  it("CANARY — the label that actually shipped is rejected", () => {
    const shipped = labelsIn(`label: "code → ollama qwen3-coder",`);
    expect(shipped).toEqual(["code → ollama qwen3-coder"]);
    expect(shipped.filter((l) => PROVIDER.test(l))).toEqual([
      "code → ollama qwen3-coder",
    ]);
  });

  it("CANARY — the retired vision label is rejected too", () => {
    expect(PROVIDER.test("vision → ollama qwen3-vl")).toBe(true);
  });

  // The guard must not fire on the legitimate labels that remain.
  it("accepts route-only labels", () => {
    for (const ok of [
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
    ]) {
      expect(PROVIDER.test(ok)).toBe(false);
    }
  });

  // The docstring above the interface deliberately names the dead models to
  // explain the incident. Scanning raw source would flag it and push the next
  // author to delete the explanation to get green.
  it("ignores model names that appear inside comments", () => {
    const withComment = `/** names ollama qwen3-vl on purpose */\nlabel: "vision",`;
    expect(labelsIn(withComment).filter((l) => PROVIDER.test(l))).toEqual([]);
  });
});
