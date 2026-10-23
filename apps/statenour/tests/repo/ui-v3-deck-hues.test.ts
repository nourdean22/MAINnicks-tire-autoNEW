/**
 * tests/repo/ui-v3-deck-hues.test.ts - bdnick appearance wave B (2026-10-23).
 *
 * The status grammar is rose, red, amber, emerald and sky (app/styles/tokens.css, the Tailwind grammar
 * block; SYSTEM.md section 9), everything else is a token. docs/design/ui-v2/SYSTEM.md section 13 bans
 * decorative purple outright. The appearance census found 27 off-grammar hue lines in 9 Chat files and
 * none in Home. This pins both Deck page trees at zero so the sweep cannot be re-added unseen.
 *
 * The scanner can fail: a planted violation must score, a clean fixture must not, a comment must not,
 * and the walk must visit named stable files, so a zero cannot mean "scanned nothing".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(__dirname, "..", "..");
const DECK_TREES = ["components/chat", "features/chat-v2", "components/home"];

/** A Tailwind class token that names an off-grammar hue: `text-violet-400`, `border-l-blue-500`, `bg-teal-500/5`. */
const OFF_GRAMMAR = /-(violet|purple|indigo|fuchsia|pink|cyan|teal|orange|lime|yellow|green|blue)-\d{2,3}\b/g;

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function offGrammarHues(src: string): string[] {
  return stripComments(src).match(OFF_GRAMMAR) ?? [];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const files = DECK_TREES.flatMap((t) => walk(join(APP, t)));
const rel = (f: string) => relative(APP, f).split("\\").join("/");

describe("offGrammarHues (the instrument)", () => {
  it("scores a planted violation in every form the census found", () => {
    expect(offGrammarHues('className="text-violet-400"')).toHaveLength(1);
    expect(offGrammarHues('border: "border-l-blue-500", bg: "bg-blue-500/5"')).toHaveLength(2);
    expect(offGrammarHues('"bg-teal-500/10 text-indigo-300 border-cyan-500/40"')).toHaveLength(3);
  });

  it("scores nothing for the status grammar, tokens, or a comment", () => {
    expect(offGrammarHues('"text-sky-300 bg-rose-500/5 border-amber-500/40 text-emerald-400 text-red-300 text-fg-secondary"')).toEqual([]);
    expect(offGrammarHues("// was text-violet-400\n/* text-blue-300 */ const a = 1;")).toEqual([]);
  });
});

describe("Deck page trees carry no off-grammar hue", () => {
  it("POSITIVE CONTROL: the walk visited the files the census named", () => {
    const seen = files.map(rel);
    for (const must of [
      "components/chat/tool-result-registry.tsx",
      "components/chat/citation-pills.tsx",
      "features/chat-v2/components/chat-island.tsx",
      "components/home/home-console.tsx",
    ]) {
      expect(seen, must).toContain(must);
    }
    expect(files.length).toBeGreaterThan(40);
  });

  it("Chat and Home use only rose, red, amber, emerald, sky and tokens", () => {
    const hits = files.flatMap((f) => offGrammarHues(readFileSync(f, "utf8")).map((h) => `${rel(f)}: ${h}`));
    expect(hits).toEqual([]);
  });
});
