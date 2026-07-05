/**
 * Guardian ↔ registry drift guard · v10.0.531
 *
 * Static source scan. Every withGuardian("<id>", …) call in the codebase
 * must be EXACTLY one of:
 *   (A) marked { reliabilityOnly: true } — an internal sub-op that skips
 *       the AI-tool policy engine and runs reliability (retry/timeout) only, or
 *   (B) a registered capability (getToolCapability(id) !== null) — a real
 *       AI-dispatchable tool the policy engine can allow/gate.
 *
 * Anything that is NEITHER is precisely the "Unknown tool ID" breakage class
 * that silently denied chat web search (google-search) until 2026-07-05, when
 * every provider/reranker/research sub-op was wrapped by an unregistered id.
 *
 * Inverse safety: a reliabilityOnly id must NEVER also be a registered tool
 * the registry says needs a human gate (owner/approval/screenshot/memory) or
 * that mutates — otherwise the opt would route a real mutation past the
 * approval flow + NICK_MUTATION_LOCK.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { getToolCapability } from "../../lib/tools/tool-registry";
import { evaluateToolAction } from "../../lib/tools/tool-policy";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_DIRS = ["lib", "app", "scripts"].map((d) => join(APP_ROOT, d));

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir may not exist in every checkout
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

interface Call {
  id: string;
  file: string;
  reliabilityOnly: boolean;
}

function extractCalls(content: string, file: string): Call[] {
  const calls: Call[] = [];
  // First string literal after `withGuardian(` is the tool id (single- or
  // multi-line forms). Guardian opts are flat objects, so the call closes at
  // the first `);` after the match — a safe window to test for the opt.
  const re = /withGuardian\(\s*["'`]([a-zA-Z0-9._-]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const window = content.slice(m.index, m.index + 800);
    const end = window.search(/\)\s*;/);
    const callText = end >= 0 ? window.slice(0, end) : window;
    calls.push({
      id: m[1],
      file,
      reliabilityOnly: /reliabilityOnly\s*:\s*true/.test(callText),
    });
  }
  return calls;
}

// Exclude the guardian module itself — it only *defines* withGuardian and
// mentions it in the doc header.
const files = SCAN_DIRS.flatMap(walk).filter(
  (f) => !f.replace(/\\/g, "/").endsWith("lib/tools/guardian.ts"),
);
const allCalls = files.flatMap((f) => extractCalls(readFileSync(f, "utf8"), f));

const rel = (f: string) => relative(APP_ROOT, f).replace(/\\/g, "/");

describe("guardian ↔ registry drift guard", () => {
  it("discovers the withGuardian call sites (sanity)", () => {
    // 25 as of 2026-07-05 · guards against the scan silently matching nothing.
    expect(allCalls.length).toBeGreaterThanOrEqual(20);
  });

  it("every withGuardian id is registered OR reliabilityOnly (no 'Unknown tool ID' class)", () => {
    const offenders = allCalls
      .filter((c) => !c.reliabilityOnly && getToolCapability(c.id) === null)
      .map((c) => `${c.id} @ ${rel(c.file)}`);
    expect(
      offenders,
      `withGuardian ids that are neither registered nor reliabilityOnly — the policy\n` +
        `engine will deny them "Unknown tool ID" at runtime. Either register the id\n` +
        `(if the AI dispatches it directly) or mark { reliabilityOnly: true } (if it is\n` +
        `an internal sub-op):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no reliabilityOnly id is also a human-gated / mutating registered tool", () => {
    const gated = allCalls
      .filter((c) => c.reliabilityOnly)
      .map((c) => ({ id: c.id, cap: getToolCapability(c.id) }))
      .filter(
        ({ cap }) =>
          !!cap &&
          (cap.memoryWriteAllowed === true ||
            cap.externalMutation === true ||
            ["owner_required", "manual_only", "screenshot_required", "memory_review_required"].includes(
              String(cap.approvalPolicy),
            )),
      )
      .map(({ id }) => id);
    expect(
      gated,
      `reliabilityOnly ids that ALSO resolve to a human-gated/mutating capability —\n` +
        `the opt would bypass the approval flow + NICK_MUTATION_LOCK:\n${gated.join("\n")}`,
    ).toEqual([]);
  });

  it("fail-closed · an unknown top-level id still denies", () => {
    const dotted = evaluateToolAction({ toolId: "zzz.nonexistent", actionType: "execute" });
    expect(dotted.decision).toBe("deny");
    expect(dotted.reason).toContain("Unknown tool ID");

    const dash = evaluateToolAction({ toolId: "nonexistent-dash", actionType: "execute" });
    expect(dash.decision).toBe("deny");
    expect(dash.reason).toContain("Unknown tool ID");
  });
});
