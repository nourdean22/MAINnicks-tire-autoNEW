/**
 * tests/repo/retired-claude-models-gate.test.ts · 2026-09-23 (Q-44)
 *
 * The Telegram photo route defaulted to claude-3-5-sonnet-latest for eleven
 * months after that model retired (2025-10-28). With ANTHROPIC_MODEL unset the
 * request failed, `if (aRes.ok)` swallowed it, and the photo silently degraded
 * to caption-only analysis. Nothing turned red, so nothing was noticed.
 *
 * This gate scans RUNTIME source (not tests, scripts, docs or .env.example)
 * for any model id on the checked-in retired list at
 * config/retired-claude-models.json (repo root, shared with nickstire's gate).
 * Comment lines are skipped: a comment recording what an id USED to be is
 * history, not a request.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RETIRED_LIST = join(APP_ROOT, "..", "..", "config", "retired-claude-models.json");

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".turbo", "coverage", "dist", "public",
  "tests", "__tests__", "e2e", "scripts", "docs",
]);
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/;

/**
 * Named exceptions. Each must say why the id is not a request to the API.
 * A stale entry (no longer matching) fails the gate too, so the list cannot rot.
 */
const ALLOWED: Array<{ file: string; id: string; reason: string }> = [
  {
    file: "lib/ai/track.ts",
    id: "claude-3-5-sonnet",
    reason: "price-table key so historical AiGeneration rows stay priced; never sent as a model",
  },
];

type Hit = { file: string; line: number; id: string };

function retiredRegexes(): RegExp[] {
  const list = JSON.parse(readFileSync(RETIRED_LIST, "utf8")) as { retired: Array<{ pattern: string }> };
  return list.retired.map((r) => new RegExp(`(?<![a-z0-9-])${r.pattern}[a-z0-9.@:-]*`, "gi"));
}

/** Pure: find retired ids in non-comment lines (the positive control drives it directly). */
function findRetired(files: Array<{ file: string; text: string }>, res: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const { file, text } of files) {
    text.split("\n").forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
      for (const re of res) {
        for (const m of line.matchAll(re)) hits.push({ file, line: i + 1, id: m[0] });
      }
    });
  }
  return hits;
}

function runtimeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) runtimeFiles(full, out);
    } else if (SOURCE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const isAllowed = (h: Hit) => ALLOWED.some((a) => a.file === h.file && h.id.toLowerCase() === a.id);

describe("no retired Claude model id in runtime source", () => {
  const res = retiredRegexes();
  const files = runtimeFiles(APP_ROOT).map((f) => ({
    file: relative(APP_ROOT, f).split("\\").join("/"),
    text: readFileSync(f, "utf8"),
  }));
  const hits = findRetired(files, res);

  it("positive control: a planted retired id is caught; the same id in a comment is not", () => {
    const planted = [
      { file: "planted.ts", text: 'const m = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";' },
      { file: "planted2.ts", text: "body: { model: 'claude-opus-4-1-20250805' }" },
      { file: "planted3.ts", text: "  // was claude-3-5-haiku-latest, retired\n  model: CURRENT," },
    ];
    const got = findRetired(planted, res);
    expect(got.map((h) => h.id)).toEqual(["claude-3-5-sonnet-latest", "claude-opus-4-1-20250805"]);
    // Current models are not on the list.
    expect(findRetired([{ file: "ok.ts", text: 'm = "claude-sonnet-5"; h = "claude-haiku-4-5"; o = "claude-opus-4-8";' }], res)).toEqual([]);
  });

  it("the scan reaches the files that carried the defect", () => {
    const scanned = new Set(files.map((f) => f.file));
    expect(scanned.has("app/api/telegram/webhook/route.ts")).toBe(true);
    expect(scanned.has("lib/ai/vision-input.ts")).toBe(true);
    expect(scanned.has("config/ai-providers.ts")).toBe(true);
    expect(files.length).toBeGreaterThan(200);
  });

  it("no runtime file names a retired model", () => {
    expect(hits.filter((h) => !isAllowed(h))).toEqual([]);
  });

  it("every allowlist entry still matches something (no stale exceptions)", () => {
    for (const a of ALLOWED) {
      expect(hits.some((h) => h.file === a.file && h.id.toLowerCase() === a.id), `${a.file} ${a.id}`).toBe(true);
    }
  });
});
