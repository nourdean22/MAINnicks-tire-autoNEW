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
 * TAB-AWARE (lens B row 7, 2026-10-25). PageTabs and Stats render only the ACTIVE tab, so a link
 * `/brain?tab=health#contradictions` lands on nothing when #contradictions is mounted by the Memory tab.
 * When the link carries `?tab=`, the hash must resolve in that tab's mount (the page's shell, which every
 * tab shows, plus the components that one tab names); a link with no `?tab=` still resolves against the union.
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

const LINK = /^\/(brain|stats|settings)(?:\?([^#]*))?#([\w-]*)(\u0000)?/;
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
      if (m) {
        const tab = m[2] ? new URLSearchParams(m[2]).get("tab") : null;
        // a tab built from a ${hole} is unknown: judge the hash against the union, as a bare link is
        out.push(`/${m[1]}${tab && !tab.includes(HOLE) ? `?tab=${tab}` : ""}#${m[3]}${m[4] ? "*" : ""}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

const IDS = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, idsIn(mounted(f))]));

type Ids = { exact: Set<string>; prefixes: string[] };

/** The key of a tab's region: a PageTabs entry `{ key: "x", render }` or an `activeTab === "x" && (...)` block. */
function tabRegionKey(n: ts.Node): string | null {
  if (ts.isObjectLiteralExpression(n)) {
    const prop = (name: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name);
    const key = prop("key");
    if (key && ts.isStringLiteral(key.initializer) && prop("render")) return key.initializer.text;
  }
  if (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    ts.isBinaryExpression(n.left) &&
    n.left.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isStringLiteral(n.left.right) &&
    /tab/i.test(n.left.left.getText())
  ) {
    return n.left.right.text;
  }
  return null;
}

/**
 * What a page mounts per tab: the ids its own JSX declares and the components it names (an import, a
 * `dynamic(() => import(...))` const, or a function in the same file), entered from the default export.
 * `shell` is what every tab shows; each tab adds the one region it owns. A page with no tab regions
 * (settings) returns no tabs and keeps the union.
 */
function pageTabs(pageFile: string): { shell: Ids; tabs: Record<string, Ids> } {
  const sf = ts.createSourceFile(pageFile, readFileSync(pageFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map<string, string>();
  const locals = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
      const spec = st.moduleSpecifier.text;
      if (st.importClause.name) imports.set(st.importClause.name.text, spec);
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imports.set(e.name.text, spec);
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      locals.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const dyn = /\bimport\(\s*["']([^"']+)["']/.exec(d.initializer.getText());
        if (dyn) imports.set(d.name.text, dyn[1]);
        else locals.set(d.name.text, d.initializer);
      }
    }
  }
  const root =
    sf.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) ?? sf;

  const keys = new Set<string>();
  (function find(n: ts.Node): void {
    const k = tabRegionKey(n);
    if (k) keys.add(k);
    ts.forEachChild(n, find);
  })(sf);

  const collect = (tab: string | null): Ids => {
    const exact = new Set<string>();
    const prefixes: string[] = [];
    const files: string[] = [];
    const seen = new Set<string>();
    const visit = (n: ts.Node): void => {
      const k = tabRegionKey(n);
      if (k !== null && k !== tab) return; // another tab's region (every region, for the shell)
      if (ts.isJsxAttribute(n) && n.name.getText() === "id" && n.initializer) {
        const init = n.initializer;
        const expr = ts.isJsxExpression(init) ? init.expression : undefined;
        const lit = ts.isStringLiteral(init) ? init.text : expr && ts.isStringLiteralLike(expr) ? expr.text : null;
        if (lit) exact.add(lit);
        else if (expr && ts.isTemplateExpression(expr) && expr.head.text) prefixes.push(expr.head.text);
      }
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText();
        const spec = imports.get(tag);
        const file = spec ? resolveImport(spec) : null;
        if (file) files.push(...mounted(file));
        else if (locals.has(tag) && !seen.has(tag)) {
          seen.add(tag);
          visit(locals.get(tag)!);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
    const fromFiles = idsIn(files);
    return { exact: new Set([...exact, ...fromFiles.exact]), prefixes: [...prefixes, ...fromFiles.prefixes] };
  };

  return { shell: collect(null), tabs: Object.fromEntries([...keys].map((k) => [k, collect(k)])) };
}

const PAGE_TABS = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, pageTabs(f)]));
const TABS: Record<string, Record<string, Ids>> = Object.fromEntries(Object.entries(PAGE_TABS).map(([k, v]) => [k, v.tabs]));

function dead(link: string): boolean {
  const [, page, tab, hash, wild] = /^\/(\w+)(?:\?tab=([\w-]+))?#([\w-]*)(\*)?$/.exec(link)!;
  // A tabbed page shows only the named tab (an unknown key shows its shell alone); a page without tabs, or a link without ?tab=, resolves against the union.
  const ids = tab && Object.keys(TABS[page]).length ? (TABS[page][tab] ?? PAGE_TABS[page].shell) : IDS[page];
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

/**
 * Dead before wave E2. Wave F (2026-10-25) fixed all nine: #beliefs, #qualitative and #nudges got their id on
 * the Memory tab (BrainFold opens the fold that holds a hash target); #recall now names #recall-preview,
 * #laws names #wisdom (the Greene laws live in the Wisdom section), #identity names /settings#identity (the
 * IdentityPanel's one home), and #promises has no Brain home, so it opens /missions (promise loops are tasks).
 * Never add to this.
 */
const KNOWN_DEAD = new Set<string>([]);

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
    // wave F: the nine repaired targets resolve, and the old spellings that had no home stay dead
    for (const live of ["/brain#beliefs", "/brain#qualitative", "/brain#nudges", "/brain#recall-preview", "/brain#wisdom", "/settings#identity"]) {
      expect(dead(live), live).toBe(false);
    }
    for (const gone of ["/brain#recall", "/brain#laws", "/brain#promises", "/brain#identity"]) expect(dead(gone), gone).toBe(true);
    expect(hashLinks('const c = { href: "/brain#ghost" };\n// "/brain#in-a-comment"')).toEqual(["/brain#ghost"]);
  });

  it("POSITIVE CONTROL (lens B row 7): a hash that lives on another tab is dead when ?tab= names this one", () => {
    // PageTabs renders only the active tab, so /brain?tab=health#contradictions lands on nothing:
    // #contradictions is mounted by the Memory tab. The gate used to drop ?tab= and union every tab.
    const planted = hashLinks('const href = "/brain?tab=health#contradictions";');
    expect(planted.length, "the scratch fixture's link was located").toBe(1);
    expect(dead(planted[0]), planted[0]).toBe(true);
    expect(dead(hashLinks('const href = "/brain?tab=memory#contradictions";')[0])).toBe(false);
    expect(dead(hashLinks('const href = "/stats?tab=mastery#forecast-duel";')[0])).toBe(true);
    expect(dead(hashLinks('const href = "/stats?tab=goals#forecast-duel";')[0])).toBe(false);
    // a shell id (outside every tab) is reachable from any tab; no ?tab= keeps the union
    expect(dead("/brain#contradictions")).toBe(false);
  });

  it("SUBJECT: the tab regions are real, differ from each other, and every shipped tab link resolves in its tab", () => {
    expect(Object.keys(TABS.brain).sort()).toEqual(["health", "memory", "review"]);
    expect(Object.keys(TABS.stats).sort()).toEqual(["body", "goals", "mastery"]);
    expect(TABS.brain.memory.exact.has("contradictions")).toBe(true);
    expect(TABS.brain.health.exact.has("contradictions")).toBe(false);
    expect(TABS.brain.health.exact.has("time-travel")).toBe(true);
    expect(TABS.stats.goals.exact.has("forecast-duel")).toBe(true);
    const tabLinks = treeLinks().filter((l) => l.includes("?tab="));
    expect(tabLinks.length, "tab-qualified hash links were located").toBeGreaterThan(10);
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
