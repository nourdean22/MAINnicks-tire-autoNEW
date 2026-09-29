/**
 * Q-44 · the SMS drafter's Claude fallback defaulted to claude-3-5-haiku-latest
 * for seven months after it retired (2026-02-19). Wherever ANTHROPIC_MODEL was
 * unset, each attempt failed, was logged as a warning and fell through —
 * nothing turned red.
 *
 * This gate scans RUNTIME source (server/, shared/, client/src/ — not tests,
 * scripts, docs or .env.example) for any model id on the checked-in retired
 * list at config/retired-claude-models.json (repo root, shared with
 * statenour's gate). Comment lines are skipped: a comment recording what an id
 * USED to be is history, not a request.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_LIST = join(APP_ROOT, "..", "..", "config", "retired-claude-models.json");
const SCAN_ROOTS = ["server", "shared", "client/src"];

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "__tests__", "tests", "scripts", "docs"]);
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/;

/** Named exceptions, each with the reason the id is not a request. None today. */
const ALLOWED: Array<{ file: string; id: string; reason: string }> = [];

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
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) runtimeFiles(full, out);
    } else if (SOURCE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no retired Claude model id in runtime source", () => {
  const res = retiredRegexes();
  const files = SCAN_ROOTS.flatMap((r) => runtimeFiles(join(APP_ROOT, r))).map((f) => ({
    file: relative(APP_ROOT, f).split("\\").join("/"),
    text: readFileSync(f, "utf8"),
  }));
  const hits = findRetired(files, res);
  const isAllowed = (h: Hit) => ALLOWED.some((a) => a.file === h.file && h.id.toLowerCase() === a.id);

  it("positive control: a planted retired id is caught; the same id in a comment is not", () => {
    const planted = [
      { file: "planted.ts", text: 'const m = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";' },
      { file: "planted2.ts", text: "body: { model: 'claude-sonnet-4-20250514' }" },
      { file: "planted3.ts", text: "  // was claude-3-5-haiku-latest, retired\n  model: CURRENT," },
    ];
    expect(findRetired(planted, res).map((h) => h.id)).toEqual(["claude-3-5-haiku-latest", "claude-sonnet-4-20250514"]);
    expect(findRetired([{ file: "ok.ts", text: 'm = "claude-sonnet-5"; h = "claude-haiku-4-5"; o = "claude-opus-4-8";' }], res)).toEqual([]);
    // 2026-09-29 · the retired ALIASES are caught too, not only the dated ids…
    expect(
      findRetired([{ file: "alias.ts", text: 'a = "claude-opus-4-1"; b = "claude-opus-4-0"; c = "claude-sonnet-4-0";' }], res).map((h) => h.id),
    ).toEqual(["claude-opus-4-1", "claude-opus-4-0", "claude-sonnet-4-0"]);
    // …and the alias patterns never reach a live id that shares their prefix.
    const live = ["claude-opus-4-5", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-5", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101"];
    expect(findRetired([{ file: "live.ts", text: live.map((id) => `"${id}"`).join(", ") }], res)).toEqual([]);
  });

  it("the scan reaches the file that carried the defect", () => {
    expect(files.some((f) => f.file === "server/services/nickgpt-client.ts")).toBe(true);
    expect(files.length).toBeGreaterThan(200);
  });

  it("no runtime file names a retired model", () => {
    expect(hits.filter((h) => !isAllowed(h))).toEqual([]);
  });
});
