/**
 * A deep link's #hash must name an element its page actually mounts (bdnick wave E2 round 6, Codex
 * 4369345426).
 *
 * THE DEFECT. Wave E2 moved Ghost Nick, calibration, prediction streaks and preferences off /brain
 * (to Stats Goals and Settings), but the `/ghost` slash command and the Ghost Nick citation pill still
 * sent the operator to `/brain#ghost`. tests/repo/deep-link-targets.test.ts cannot see that: it checks
 * the PATH only (it drops everything after `?` or `#`, line 181), and /brain exists.
 *
 * This reads every string or template literal in the shipped tree that starts `/brain`, `/stats` or
 * `/settings` and carries a `#hash`, and resolves the hash against the ids in the files that page
 * mounts: its page.tsx and everything reachable from it through `@/components/...` and `@/features/...`
 * imports. A static `id="x"` and a template id's fixed prefix (`id={`pin-${id}`}`) both count. A hash
 * built from a `${hole}` resolves by its prefix.
 *
 * KNOWN_DEAD holds hashes that were dead before E2 and belong to another lane (chat citation pills and
 * slash commands): listed, never added to; the reverse canary fails when one is fixed.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const PAGES: Record<string, string> = {
  brain: "app/(mastery)/brain/page.tsx",
  stats: "app/(mastery)/stats/page.tsx",
  settings: "app/(mastery)/settings/page.tsx",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.[jt]sx?$|\.d\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const resolveImport = (spec: string): string | null => {
  if (!spec.startsWith("@/components/") && !spec.startsWith("@/features/")) return null;
  const base = spec.slice(2);
  for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) if (existsSync(c)) return c;
  return null;
};

/** The page file and every component file reachable from it. */
function mounted(pageFile: string): string[] {
  const seen = new Set<string>([pageFile]);
  const queue = [pageFile];
  while (queue.length) {
    const f = queue.shift()!;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)["']([^"']+)["']/g)) {
      const r = resolveImport(m[1]);
      if (r && !seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  return [...seen];
}

/** Static ids and template-id prefixes in a set of files ("pin-" for id={`pin-${x}`}). */
function idsIn(files: string[]): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bid=["']([\w-]+)["']/g)) exact.add(m[1]);
    for (const m of src.matchAll(/\bid=\{["']([\w-]+)["']\}/g)) exact.add(m[1]);
    for (const m of src.matchAll(/\bid=\{`([\w-]*)\$\{/g)) if (m[1]) prefixes.push(m[1]);
  }
  return { exact, prefixes };
}

const LINK = /^\/(brain|stats|settings)(?:\?[^#]*)?#([\w-]*)(\u0000)?/;
const HOLE = "\u0000";

/** "<file> -> /page#hash" for every hash link a source emits (comments are not nodes). */
function hashLinks(src: string, file = "probe.tsx"): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  (function visit(n: ts.Node): void {
    let text: string | undefined;
    if (ts.isStringLiteralLike(n)) text = n.text;
    else if (ts.isTemplateExpression(n)) text = n.head.text + n.templateSpans.map((s) => HOLE + s.literal.text).join("");
    if (text !== undefined) {
      const m = LINK.exec(text);
      if (m) out.push(`/${m[1]}#${m[2]}${m[3] ? "*" : ""}`);
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

const IDS = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, idsIn(mounted(f))]));

function dead(link: string): boolean {
  const [, page, hash, wild] = /^\/(\w+)#([\w-]*)(\*)?$/.exec(link)!;
  const ids = IDS[page];
  if (!hash) return false;
  if (wild) return !ids.prefixes.some((p) => p.startsWith(hash) || hash.startsWith(p)) && ![...ids.exact].some((x) => x.startsWith(hash));
  return !ids.exact.has(hash) && !ids.prefixes.some((p) => hash.startsWith(p));
}

function treeLinks(): string[] {
  return ["lib", "app", "components", "features", "hooks"].flatMap((d) => walk(d)).flatMap((f) => {
    const rel = relative(".", f).split(sep).join("/");
    return hashLinks(readFileSync(f, "utf8"), rel).map((l) => `${rel} -> ${l}`);
  });
}

/** Dead before wave E2, owned by the chat lane (citation pills, slash commands). Never add to this. */
const KNOWN_DEAD = new Set<string>([
  "components/chat/citation-pills.tsx -> /brain#recall",
  "components/chat/citation-pills.tsx -> /brain#identity",
  "components/chat/citation-pills.tsx -> /brain#qualitative",
  "components/chat/citation-pills.tsx -> /brain#beliefs",
  "components/chat/citation-pills.tsx -> /brain#nudges",
  "components/chat/citation-pills.tsx -> /brain#laws",
  "components/chat/citation-pills.tsx -> /brain#promises",
  "hooks/use-slash-commands.ts -> /brain#identity",
  "hooks/use-slash-commands.ts -> /brain#beliefs",
]);

const sweep = () => [...new Set(treeLinks().filter((l) => dead(l.slice(l.indexOf(" -> ") + 4))))];

describe("deep-link hashes name an element their page mounts", () => {
  it("SUBJECT: each page's mount graph and ids are real", () => {
    expect(mounted(PAGES.brain).length).toBeGreaterThan(20);
    expect(mounted(PAGES.stats).length).toBeGreaterThan(10);
    expect(IDS.brain.exact.has("contradictions")).toBe(true);
    expect(IDS.stats.exact.has("forecast-duel")).toBe(true);
    expect(treeLinks().length).toBeGreaterThan(20);
  });

  it("POSITIVE CONTROL: the old Ghost Nick target and an invented hash are dead; a live one is not", () => {
    expect(dead("/brain#ghost")).toBe(true);
    expect(dead("/stats#no-such-section")).toBe(true);
    expect(dead("/brain#contradictions")).toBe(false);
    expect(dead("/stats#forecast-duel")).toBe(false);
    expect(hashLinks('const c = { href: "/brain#ghost" };\n// "/brain#in-a-comment"')).toEqual(["/brain#ghost"]);
  });

  it("no deep link's hash points at an element its page does not mount", () => {
    const broken = sweep().filter((l) => !KNOWN_DEAD.has(l));
    expect(broken, "repoint to where the element now mounts:\n  " + broken.join("\n  ")).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN_DEAD entry is still dead (delete it once fixed)", () => {
    const live = new Set(sweep());
    expect([...KNOWN_DEAD].filter((k) => !live.has(k))).toEqual([]);
  });
});
