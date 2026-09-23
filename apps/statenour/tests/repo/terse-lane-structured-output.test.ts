/**
 * An `aiChat` call that PARSES STRUCTURED OUTPUT must not silently sit on the
 * terse lane.
 *
 * WHY THIS GUARD EXISTS — measured in production 2026-09-17.
 *
 * `provider.ts` caps `fast`/`classify` at 1500 tokens / 45s, documented as
 * "terse responses", and resolves them to `OLLAMA_FAST_MODEL` (a light-filter
 * model). Measured over 3 days of production `.doGenerate` spans:
 *   · the fast model returned EMPTY CONTENT on 7 of 31 (23%); the reason model
 *     on 0 of 16
 *   · the fast lane's observed max was exactly 1500 — the ceiling truncating
 *     JSON mid-structure
 *
 * ⚠ COUNT CHILD SPANS, NOT PARENTS. `ai.generateText` parent spans never carry
 * usage while their `.doGenerate` children do, so counting both manufactures an
 * exact-50% "zero token" rate that does not exist. An earlier draft of this
 * comment published that figure. The signal is EMPTY CONTENT, not token count.
 * Every empty or unparseable result fell through to the METERED rescue tail,
 * where gemini / openrouter / openai failed on billing: 2,963 Langfuse ERROR
 * observations in 7d across six brain surfaces.
 *
 * ⚠⚠ THE FIRST VERSION OF THIS GUARD MATCHED A LINE SHAPE, NOT A CALL.
 * It required `], "fast")` on ONE line, so every multiline call — the majority —
 * was invisible. It reported the tree clean while EIGHT instances remained.
 * Review caught it. The detector now keys on ARGUMENT POSITION: the task-type
 * literal preceded by `]` or `,` and followed by an optional trailing comma and
 * the closing paren, which matches both formattings.
 *
 * ⚠ AND THE FIX IS NOT "CHANGE THEM ALL". A terse lane is CORRECT when the
 * structured output is genuinely small — `specialist-router` emits
 * `{intent, mode, targets}` and fits 1500 tokens easily; forcing it to `reason`
 * would slow every turn's routing for nothing. So this is a RATCHET: existing
 * sites are allowlisted with a reason, and any NEW one fails until it is either
 * fixed or justified here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];

/**
 * Argument position, not line shape.
 *
 * The task type is `aiChat`'s SECOND argument and may be followed by a THIRD
 * (`{ signal }`), so this must not require the closing paren straight after.
 * Requiring `)` was the third formatting this detector missed — it hid
 * `chain-of-verification.ts`, a surface production was already failing on.
 *
 * Matches: `], "fast")` · `],\n "fast"\n)` · `],\n "fast",\n)` ·
 *          `],\n "fast",\n { signal },\n)`
 */
const TERSE_ARG = /[\],]\s*"(fast|classify)"\s*[,)]/g;
const PARSES_STRUCTURE = /extractJson(Array|Object)|JSON\.parse\(\s*(result|aiResult)\.content/;
/** How far after the call the result may still be parsed. */
const WINDOW_CHARS = 700;

/**
 * Sites where a terse lane is DELIBERATE because the structured payload is
 * small. Each needs a reason; an unexplained entry is how a ratchet rots.
 *
 * ⚠ These are NOT verified-good, they are UNMEASURED. None appears in the six
 * failing Langfuse surfaces, which is why they were not changed on speculation.
 * If one starts spilling onto metered providers, fix it and delete the line.
 */
const ALLOWLIST: Record<string, string> = {
  "lib/ai/agents/router.ts": "classify -> {intent, mode, targets}; small by construction",
  "lib/ai/memory.ts": "fact extraction, short list; not in the failing set",
  "lib/brain/contextual-recall.ts": "recall ids; not in the failing set",
  "lib/brain/journal-ingest.ts": "ingest tags; not in the failing set",
  "lib/brain/people-intelligence.ts": "per-person enrichment object; not in the failing set",
  "lib/brain/session-distiller.ts": "distill object; not in the failing set",
  "lib/brain/strategic-plans.ts": "plan array; not in the failing set",
  "lib/services/chat-suggestions.ts":
    "3 strings of <=48 chars each; latency-sensitive UI path with its own AbortController",
};

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

/**
 * Blank out comments while PRESERVING line numbers, so a reported `file:line`
 * still points at the real call.
 *
 * ⚠⚠ THIS IS LOAD-BEARING, AND IT WAS MISSING. The detector anchors on `]` or
 * `,` immediately before the task type. A comment between them — exactly what
 * an explanatory note above the argument looks like — breaks the anchor and the
 * call becomes invisible. Proven: adding a rationale comment above
 * `chain-of-verification`'s task type made a verified `"fast"` mutation pass the
 * guard. So the very act of documenting a fix could hide its regression.
 *
 * Stripping also stops a task type MENTIONED in prose from counting as a call —
 * the mention-blind defect this repo has already recorded twice.
 */
function stripComments(src: string): string {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** @returns `relativePath:line` for every terse call whose result is parsed. */
export function findMismatches(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, "utf8"));
    if (!src.includes("aiChat(")) continue;
    const re = new RegExp(TERSE_ARG.source, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!PARSES_STRUCTURE.test(src.slice(m.index, m.index + WINDOW_CHARS))) continue;
      const rel = relative(ROOT, f).split("\\").join("/");
      out.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const MISMATCHES = findMismatches(FILES);

describe("terse lane vs structured output", () => {
  // POSITIVE CONTROL — without this, a broken walker or renamed helper makes
  // every assertion below pass on an empty file list.
  it("the scan sees the tree and finds aiChat callers", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.filter((f) => readFileSync(f, "utf8").includes("aiChat(")).length).toBeGreaterThan(5);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The detector must see MULTILINE calls. The previous line-anchored regex
  // reported the tree clean while eight of these existed.
  it("CANARY — detects the multiline form the first version missed", () => {
    const multiline = [
      "      aiChat(",
      "        [",
      '          { role: "user", content: x },',
      "        ],",
      '        "fast"',
      "      );",
      "",
      "      const e = extractJsonObject<any>(result.content);",
    ].join("\n");
    const re = new RegExp(TERSE_ARG.source, "g");
    const m = re.exec(multiline);
    expect(m).not.toBeNull();
    expect(PARSES_STRUCTURE.test(multiline.slice(m!.index, m!.index + WINDOW_CHARS))).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The task type is aiChat's SECOND argument and may be followed by a THIRD
  // (`{ signal }`). Requiring the close paren straight after hid
  // chain-of-verification.ts — a surface production was ALREADY failing on.
  it("CANARY — detects a task type followed by a further argument", () => {
    const withOpts = [
      "      ],",
      '      "fast",',
      "      { signal: opts.signal },",
      "    );",
      "",
      "    const parsed = extractJsonArray<string>(planRes.content);",
    ].join("\n");
    const re = new RegExp(TERSE_ARG.source, "g");
    const m = re.exec(withOpts);
    expect(m).not.toBeNull();
    expect(PARSES_STRUCTURE.test(withOpts.slice(m!.index, m!.index + WINDOW_CHARS))).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // A comment between the messages array and the task type must NOT hide the
  // call. Without comment-stripping this exact shape made a verified "fast"
  // mutation pass — i.e. documenting a fix could conceal its own regression.
  it("CANARY — a comment above the task type does not hide the call", () => {
    const commented = [
      "      ],",
      "      // 2026-09-17 · was \"fast\". Long rationale that sits between the",
      "      // messages array and the argument being guarded.",
      '      "fast",',
      "      { signal: opts.signal },",
      "    );",
      "",
      "    const parsed = extractJsonArray<string>(planRes.content);",
    ].join("\n");
    const stripped = stripComments(commented);
    const re = new RegExp(TERSE_ARG.source, "g");
    const m = re.exec(stripped);
    expect(m).not.toBeNull();
    expect(PARSES_STRUCTURE.test(stripped.slice(m!.index, m!.index + WINDOW_CHARS))).toBe(true);
    // …and the raw form is exactly what slipped through before.
    expect(new RegExp(TERSE_ARG.source, "g").exec(commented)).toBeNull();
  });

  it("CANARY — also detects the trailing-comma form", () => {
    const trailing = ['        ],', '        "classify",', "      );", "", "      extractJsonArray<any>(result.content);"].join("\n");
    const re = new RegExp(TERSE_ARG.source, "g");
    const m = re.exec(trailing);
    expect(m).not.toBeNull();
  });

  it("CANARY — and the original single-line form", () => {
    const single = ['    ], "fast");', "", "    const e = extractJsonArray<any>(result.content);"].join("\n");
    const re = new RegExp(TERSE_ARG.source, "g");
    expect(re.exec(single)).not.toBeNull();
  });

  // The guard must not fire on prose results — those cannot fail to parse and
  // do not cause the fall-through. pipeline-controller still has one.
  it("does NOT flag a terse call whose result is used as prose", () => {
    const prose = ['  ], "fast");', "", "  return { brief: result.content };"].join("\n");
    const re = new RegExp(TERSE_ARG.source, "g");
    const m = re.exec(prose);
    expect(m).not.toBeNull(); // the call matches…
    expect(PARSES_STRUCTURE.test(prose.slice(m!.index, m!.index + WINDOW_CHARS))).toBe(false); // …but is not parsed
  });

  // ── THE RATCHET ─────────────────────────────────────────────────────
  it("every terse+structured site is explicitly allowlisted with a reason", () => {
    const unexplained = MISMATCHES.filter((hit) => !ALLOWLIST[hit.split(":")[0]]);
    expect(unexplained).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const seen = new Set(MISMATCHES.map((h) => h.split(":")[0]));
    expect(Object.keys(ALLOWLIST).filter((f) => !seen.has(f))).toEqual([]);
  });

  it("every allowlist entry carries a non-empty reason", () => {
    expect(Object.entries(ALLOWLIST).filter(([, why]) => !why || why.length < 10)).toEqual([]);
  });

  // The lanes that were actually failing in production must stay fixed.
  it("the six failing surfaces are not on the terse lane", () => {
    const failing = [
      "lib/brain/memory-consolidation.ts",
      "lib/brain/conversation-memory.ts",
      "lib/brain/relational-graph.ts",
      "lib/brain/decision-patterns.ts",
      "lib/brain/pipeline-controller.ts",
      "lib/brain/thinking-engine.ts",
      "lib/ai/chat/chain-of-verification.ts",
    ];
    const stillTerse = MISMATCHES.filter((h) => failing.includes(h.split(":")[0]));
    expect(stillTerse).toEqual([]);
  });
});
