/**
 * An `aiChat` call that PARSES STRUCTURED OUTPUT must not request the terse lane.
 *
 * WHY THIS GUARD EXISTS — measured in production 2026-09-17.
 *
 * `provider.ts` caps `fast`/`classify` at 1500 tokens / 45s, documented as
 * "terse responses", and resolves them to `OLLAMA_FAST_MODEL` (a light-filter
 * model). Five brain call sites asked for that lane and then ran
 * `extractJsonArray` / `extractJsonObject` on the result.
 *
 * On the memory-consolidation lane that combination produced, in 24h:
 *   · 106 Ollama calls · **53 returned ZERO completion tokens** · 46 empty output
 *   · observed max exactly 1500 tokens — the ceiling truncating JSON mid-structure
 *
 * Every empty or unparseable result made the provider chain fall through to the
 * METERED rescue tail, where gemini / openrouter / openai failed on billing:
 * 2,963 Langfuse ERROR observations in 7d across six brain surfaces, while
 * `error_logs` showed 44. **A task-type mismatch inside the FUNDED lane was
 * presenting as a spend problem.**
 *
 * ⚠ THIS IS A SWEEP, NOT A SITE FIX. The first four siblings were found only by
 * scanning for the shape after fixing one — and three of them were exactly the
 * surfaces production was already failing on. The repo's own rule: a fix applied
 * per-site leaves siblings behind.
 *
 * NOT flagged: a terse call whose result is used as PROSE (e.g. a generated
 * brief). Those cannot fail to parse, so they do not cause the fall-through.
 * The guard keys on the parse, not on the task type alone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];
/** How many lines after the call may still count as "this call's result". */
const WINDOW = 6;

const TERSE_CALL = /\],\s*"(fast|classify)"\)/;
const PARSES_STRUCTURE = /extractJson(Array|Object)|JSON\.parse\(\s*result\.content/;

function walk(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, acc);
    } else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/** @returns `file:line` for every terse call whose result is parsed as structure. */
function findMismatches(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("aiChat(")) continue;
    const lines = src.split("\n");
    lines.forEach((l, i) => {
      if (!TERSE_CALL.test(l)) return;
      if (PARSES_STRUCTURE.test(lines.slice(i, i + WINDOW).join("\n"))) {
        out.push(`${f.replace(/\\/g, "/")}:${i + 1}`);
      }
    });
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe("terse lane vs structured output", () => {
  // POSITIVE CONTROL — without this, a broken walker or a renamed helper makes
  // every assertion below pass on an empty file list.
  it("the scan actually sees the tree and finds aiChat callers", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.filter((f) => readFileSync(f, "utf8").includes("aiChat(")).length).toBeGreaterThan(5);
  });

  it("no aiChat call requests fast/classify and then parses structured output", () => {
    expect(findMismatches(FILES)).toEqual([]);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The exact shape that shipped. If this stops matching, the detector is
  // broken and the clean result above means nothing.
  it("CANARY — the shipped shape is detected", () => {
    const shipped = [
      '    const result = await aiChat([',
      '      { role: "user", content: memList },',
      '    ], "fast");',
      '',
      '    const extracted = extractJsonArray<{ indices: number[] }>(result.content);',
    ].join("\n");
    const lines = shipped.split("\n");
    const hit = lines.some(
      (l, i) => TERSE_CALL.test(l) && PARSES_STRUCTURE.test(lines.slice(i, i + WINDOW).join("\n")),
    );
    expect(hit).toBe(true);
  });

  // The guard must not fire on a terse call whose output is prose — that shape
  // is legitimate and still exists in pipeline-controller.
  it("does NOT flag a terse call whose result is used as prose", () => {
    const prose = ['  ], "fast");', "", "  return { brief: result.content };"].join("\n");
    const lines = prose.split("\n");
    const hit = lines.some(
      (l, i) => TERSE_CALL.test(l) && PARSES_STRUCTURE.test(lines.slice(i, i + WINDOW).join("\n")),
    );
    expect(hit).toBe(false);
  });
});
