/**
 * A link the app hands the operator must open a page that exists (audit
 * 2026-10-10 · 02-F9).
 *
 * THE DEFECT. Server code writes links into Telegram pushes and emails, where
 * no type checker or page router ever sees them:
 *
 *   camera-intelligence   "Check cameras at bdnick.info/cameras"    (404)
 *   email.ts              deviceOfflineEmail -> bdnick.info/devices (404,
 *                         and the template had no caller at all)
 *   autonomous-engine     bdnick.info/appointments, bdnick.info/loops (404)
 *
 * tests/repo/system-nav-targets.test.ts already guards `/system/<seg>` hrefs.
 * This guards every other page path the app emits, in the two forms that can
 * only mean "go here": a `bdnick.info/<path>` URL (any case, any string or
 * template literal, a same-file const origin read through), and a key, prop or
 * variable named `*href` / `*link` / `*url` set to a "/<path>" literal. A path
 * resolves when an app/** page.tsx serves it, a next.config.ts redirect source
 * matches it, or public/ holds the file. `/api/` paths are routes, not pages,
 * and are skipped.
 *
 * Read from each file's syntax tree (hardened 2026-10-10 after a red team found
 * `link:` / `deepLink:` / `url:` keys, JSX `href={"..."}`, upper-case hosts,
 * app/ cron routes and comment mentions all read wrong by the old regexes):
 * comments are never links, and a `${hole}` makes its segment unknowable ("*").
 */
import { beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Three full-tree sweeps of 5 to 7 s each run back to back as synchronous tests (17.5 s quiet, measured
// 2026-10-15), and the runner does not turn the worker's event loop between synchronous tests. On a slow
// machine that stretch nears vitest's 60 s RPC timeout, which fails the run with
// `Timeout calling "onTaskUpdate"` and no failing test. See repo-canary-gates.redteam.test.ts for the measurement.
beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** app/(mastery)/decisions/[id]/page.tsx -> ["decisions", "[id]"] (groups and slots dropped). */
function pageRoutes(): string[][] {
  return walk("app", (f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f)).map((f) =>
    relative("app", f)
      .split(sep)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")),
  );
}

/**
 * The `source` of each entry in the array `redirects` returns, read from the syntax tree, so
 * headers() (whose "/:path*" source matches everything) or a comment naming `redirects:` cannot
 * leak in. Fails closed when no `redirects` returning an array literal exists.
 */
function redirectSources(cfg = readFileSync("next.config.ts", "utf8")): string[][] {
  const sf = ts.createSourceFile("next.config.ts", cfg, ts.ScriptTarget.Latest, true);
  let list: ts.ArrayLiteralExpression | undefined;
  const arrayIn = (body: ts.Node | undefined): ts.ArrayLiteralExpression | undefined => {
    while (body && ts.isParenthesizedExpression(body)) body = body.expression;
    if (body && ts.isArrayLiteralExpression(body)) return body;
    if (body && ts.isBlock(body)) {
      for (const s of body.statements) if (ts.isReturnStatement(s) && arrayIn(s.expression)) return arrayIn(s.expression);
    }
    return undefined;
  };
  (function find(n: ts.Node): void {
    if (list) return;
    if ((ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && n.name.getText(sf) === "redirects") {
      const fn = ts.isMethodDeclaration(n) ? n : n.initializer;
      list = ts.isMethodDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? arrayIn(fn.body) : undefined;
    }
    ts.forEachChild(n, find);
  })(sf);
  if (!list) throw new Error("next.config.ts has no redirects block (a `redirects` returning an array literal)");
  return list.elements.flatMap((el) => {
    const src = ts.isObjectLiteralExpression(el)
      ? el.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === "source")
      : undefined;
    return src && ts.isStringLiteralLike(src.initializer) ? [src.initializer.text.split("/").filter(Boolean)] : [];
  });
}

/** Does a target path (segments; "*" = a template hole) match a route pattern? */
function matches(target: string[], pattern: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (/^\[\[?\.\.\./.test(p) || /^:\w+\*$/.test(p)) return true; // catch-all
    if (i >= target.length) return false;
    if (/^\[.+\]$/.test(p) || /^:\w+$/.test(p) || target[i] === "*") continue;
    if (p !== target[i]) return false;
  }
  return target.length === pattern.length;
}

/** A `${hole}` whose value cannot be read. Its whole segment becomes "*" (unknowable, never dead). */
const HOLE = "\u0000";
/** Names that can only hold a destination: href, navHref, link, deepLink, url, callbackURL... */
const LINK_KEY = /(?:href|link|url)$/i;
const BDNICK_URL = /bdnick\.info(\/[^\s"'`<>)\]\\]*)/gi;

/**
 * Page paths a source emits as navigation, read from its syntax tree. Comments are not nodes, so
 * a mention is never a link. String and template literals and JSX text are read for a bdnick.info
 * URL; a link-named key, prop, variable or assignment is read for a "/path" value (through parens,
 * `as`, JSX braces, both branches of `?:`, both sides of `??` / `||`). A template hole holding a
 * same-file `const` string is read through (`${BASE}/cameras`); any other hole is unknowable.
 */
function deepLinks(input: string, file = "probe.tsx"): string[] {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true, kind);
  const consts = new Map<string, string>();
  const nodes: ts.Node[] = [];
  (function collect(n: ts.Node): void {
    nodes.push(n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteralLike(n.initializer)) {
      if (ts.getCombinedNodeFlags(n) & ts.NodeFlags.Const) consts.set(n.name.text, n.initializer.text);
    }
    ts.forEachChild(n, collect);
  })(sf);

  const unwrap = (e: ts.Node): ts.Node => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isJsxExpression(e)) {
      if (!e.expression) break;
      e = e.expression;
    }
    return e;
  };
  const textOf = (n: ts.Node): string | undefined => {
    const e = unwrap(n);
    if (ts.isStringLiteralLike(e) || ts.isJsxText(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      const hole = (x: ts.Expression) => (ts.isIdentifier(x) && consts.has(x.text) ? consts.get(x.text) : HOLE);
      return e.head.text + e.templateSpans.map((s) => hole(s.expression) + s.literal.text).join("");
    }
    return undefined;
  };
  /** Every string a link-named slot can end up holding. */
  const valuesOf = (n: ts.Node): string[] => {
    const e = unwrap(n);
    if (ts.isConditionalExpression(e)) return [...valuesOf(e.whenTrue), ...valuesOf(e.whenFalse)];
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) {
      return [...valuesOf(e.left), ...valuesOf(e.right)];
    }
    const t = textOf(e);
    return t === undefined ? [] : [t];
  };
  /** The link-named slot a node fills, if any: [its name, its value]. */
  const slot = (n: ts.Node): [string, ts.Node] | undefined => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = n.left;
      const name = ts.isIdentifier(l) ? l.text : ts.isPropertyAccessExpression(l) ? l.name.text : undefined;
      return name ? [name, n.right] : undefined;
    }
    if (ts.isLabeledStatement(n) && ts.isExpressionStatement(n.statement)) return [n.label.text, n.statement.expression];
    const named = n as ts.Node & { name?: ts.Node; initializer?: ts.Node };
    if (!named.initializer || !named.name) return undefined;
    if (!(ts.isPropertyAssignment(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isParameter(n) || ts.isPropertyDeclaration(n) || ts.isJsxAttribute(n))) {
      return undefined;
    }
    const name = ts.isIdentifier(named.name) || ts.isStringLiteral(named.name) ? named.name.text : named.name.getText(sf);
    return [name, named.initializer];
  };

  const out: string[] = [];
  for (const n of nodes) {
    if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || ts.isJsxText(n)) {
      for (const m of (textOf(n) ?? "").matchAll(BDNICK_URL)) out.push(m[1]);
    }
    const s = slot(n);
    if (s && LINK_KEY.test(s[0])) for (const v of valuesOf(s[1])) if (v.startsWith("/")) out.push(v);
  }
  return out
    .map((p) => p.split(/[?#]/)[0].replace(/[.,;:]+$/, ""))
    .map((p) => p.split("/").map((seg) => (seg.includes(HOLE) ? "*" : seg)).join("/"))
    .filter((p) => !p.startsWith("/api/"));
}

function resolves(path: string, routes: string[][]): boolean {
  const target = path.split("/").filter(Boolean);
  return routes.some((r) => matches(target, r)) || (!path.includes("*") && path !== "/" && existsSync(join("public", path)));
}

/**
 * Links known dead but owned by another change ("<file> -> <path>"). Empty
 * since the autonomous-engine links were repointed (audit wave 2). The reverse
 * canary below fails as soon as one is fixed, naming the entry to delete here.
 */
const KNOWN_DEAD = new Set<string>([]);

const ROUTES = [...pageRoutes(), ...redirectSources()];

/** Every tree that ships code: server pushes (lib/, app/api/cron), pages and client UI. Tests are not shipped. */
const SWEEP_DIRS = ["lib", "app", "components", "features", "hooks"];
const SHIPPED = (f: string) => /\.(ts|tsx|mts|mjs|js|jsx)$/.test(f) && !/\.(test|spec)\.[jt]sx?$|\.d\.ts$/.test(f);

/** Every link the shipped tree emits, as "<file> -> <path>". */
function treeLinks(): string[] {
  return SWEEP_DIRS.flatMap((d) => walk(d, SHIPPED)).flatMap((f) => {
    const rel = relative(".", f).split(sep).join("/");
    return deepLinks(readFileSync(f, "utf8"), rel).map((p) => `${rel} -> ${p}`);
  });
}

function sweep(): string[] {
  return treeLinks().filter((l) => !resolves(l.slice(l.indexOf(" -> ") + 4), ROUTES));
}

describe("deep links resolve to a page or a redirect", () => {
  it("SUBJECT: the route table, the sweep and the links it reads are all real", () => {
    expect(pageRoutes().length).toBeGreaterThan(20);
    expect(redirectSources().length).toBeGreaterThan(30);
    expect(SWEEP_DIRS.flatMap((d) => walk(d, SHIPPED)).length).toBeGreaterThan(800);
    // The instrument fired: the tree emits ~380 links (2026-10-10), from server code AND UI.
    const links = treeLinks();
    expect(links.length).toBeGreaterThan(250);
    for (const dir of ["lib/", "app/api/cron/", "components/"]) expect(links.some((l) => l.startsWith(dir)), dir).toBe(true);
  });

  it("POSITIVE CONTROL: a planted dead link is flagged, in every form", () => {
    const planted = [
      "sendTelegram(`Check at bdnick.info/cameras`);",
      'const x = { href: "/nowhere-page" };',
      'push({ deepLink: "/dead-a", link: "/dead-b", url: "/dead-c" });',
      'const el = <a href={"/dead-d"}>x</a>;',
      'const BASE = "https://bdnick.info";\nsend(`${BASE}/dead-e`);',
      '"https://BDNICK.INFO/dead-f";',
    ].join("\n");
    expect(deepLinks(planted).filter((p) => !resolves(p, ROUTES))).toEqual(
      ["/cameras", "/nowhere-page", "/dead-a", "/dead-b", "/dead-c", "/dead-d", "/dead-e", "/dead-f"],
    );
  });

  it("NEGATIVE CONTROL: a mention in a comment, and an unknowable hole, are not dead links", () => {
    const fine = [
      "sendTelegram(text); // was bdnick.info/cameras",
      "const t = 1; /* old bdnick.info/cameras */",
      "send(`https://bdnick.info/${encodeURIComponent(page)}`);",
      "send(`https://bdnick.info/${ page }`);",
      'const icon = { iconUrl: "/icon-192.png" };', // a public/ file
    ].join("\n");
    expect(deepLinks(fine).filter((p) => !resolves(p, ROUTES))).toEqual([]);
  });

  it("the redirect table is read from redirects() only: a comment or headers() above it cannot leak in", () => {
    // Positive control for the parser: on the old text slice from the first "redirects:", this
    // config read headers()' "/:path*" as a redirect, and every path resolved.
    const cfg =
      '// see redirects: further down\nexport default {\n  headers: async () => [{ source: "/:path*", headers: [] }],\n' +
      '  async redirects() { return [{ source: "/old", destination: "/" }]; },\n};';
    expect(redirectSources(cfg)).toEqual([["old"]]);
    expect(() => redirectSources("export default { async headers() { return []; } };")).toThrow(/no redirects block/);
  });

  it("NEGATIVE CONTROL: real pages, dynamic pages, redirects, API paths and comments pass", () => {
    const fine = [
      '`bdnick.info/system/crons`',
      'href: `/decisions/${dec.id}`',
      'href: "/stats?tab=body"',
      '"https://bdnick.info/mastery"', // redirect -> /stats
      '"https://bdnick.info/api/inngest"',
      "  // bdnick.info/no-such-page in a comment",
      '"https://bdnick.info/"',
    ].join("\n");
    expect(deepLinks(fine).filter((p) => !resolves(p, ROUTES))).toEqual([]);
  });

  it("no deep link points at a page that does not exist", () => {
    const broken = sweep().filter((b) => !KNOWN_DEAD.has(b));
    expect(
      broken,
      "these send the operator to a 404. Repoint to a real page, add a next.config " +
        "redirect, or delete the link:\n  " + broken.join("\n  "),
    ).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN_DEAD entry is still dead (delete it once fixed)", () => {
    const live = new Set(sweep());
    const fixed = [...KNOWN_DEAD].filter((k) => !live.has(k));
    expect(fixed, "fixed, so remove from KNOWN_DEAD:\n  " + fixed.join("\n  ")).toEqual([]);
  });
});
