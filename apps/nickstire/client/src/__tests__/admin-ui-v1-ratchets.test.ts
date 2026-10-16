/**
 * Admin UI v1 ratchets (Wave 0, 2026-10-16, apps/nickstire/docs/design/admin-ui-v1/PLAN.md section 3).
 *
 * Seven UI-grammar counters over the admin source, with a per-file baseline in
 * admin-ui-v1-ratchets.baseline.json. W0 changes no class name: the baseline RECORDS today's
 * violations. The test fails when a file rises above its number, when a file the baseline has never
 * seen has any hit, when a total rises, or when the baseline names a file the scan no longer visits.
 * Later waves lower the baseline. Mechanism ported from apps/statenour/tests/repo/ui-v3-ratchets.test.ts.
 *
 * Scan scope (app-root-relative POSIX keys): client/src/pages/Admin.tsx, every non-test .ts/.tsx under
 * client/src/pages/admin and client/src/components/admin, and client/src/index.css for the CSS counters.
 * .d.ts, *.test.*, *.spec.*, __tests__ and dot-directories are skipped. Only string literals, template
 * literal pieces, JSX text and CSS outside comments are read, so a comment never counts.
 *
 *   uppercase      the `uppercase` class token (any variant prefix) in a string or template literal;
 *                  `text-transform: uppercase` and `@apply uppercase` in CSS
 *   emDash         U+2014 in a string, template or JSX text; &mdash; and its numeric spellings in JSX
 *                  text and JSX attribute strings; in CSS outside comments
 *   emoji          an Extended_Pictographic code point in a string, template, JSX text or CSS, one per
 *                  ZWJ sequence, minus the sanctioned glyphs (check mark, open circle, exclamation,
 *                  multiplication sign, question mark, copyright, registered, trademark, small x)
 *   transitionAll  the `transition-all` utility, `transition-[...all...]` and `[transition:...all...]`,
 *                  an inline `transition` / `transitionProperty` value naming `all`, an
 *                  `el.style.transition = "all ..."` assignment, and a CSS transition declaration naming all
 *   slowDuration   a Tailwind duration over 300 ms (duration-500, duration-[400ms], duration-[0.5s]),
 *                  also inside CSS @apply
 *   smallInput     an input or textarea element (also Input, Textarea, TextArea and any tag ending in
 *                  one of those) whose own className sets an unprefixed font size under 16px (text-xs,
 *                  text-sm, text-[Npx], rem or em under 1, with or without the v4 `!` suffix) or whose
 *                  inline style sets fontSize under 16px. A native <select> counts too: iOS Safari zooms
 *                  inputs, textareas and selects on focus under 16px. Checkbox, radio, range, file, hidden, color and
 *                  button-like types are exempt. A className held in a same-file const is followed.
 *   offPalette     a colour utility whose family is purple, violet, indigo, pink, fuchsia, cyan or rose
 *                  ((text|bg|border|border-{t,b,l,r,x,y,s,e}|ring|ring-offset|from|to|via|fill|stroke|shadow|
 *                  outline|accent|caret|decoration|divide|placeholder)-<family>-), any variant prefix, with or
 *                  without the Tailwind v4 `!` suffix (bg-violet-500!)
 *
 * HOW THE BASELINE MOVES. It never tightens by itself. A wave PR that removes violations runs
 *   UPDATE_RATCHET=1 node node_modules/vitest/vitest.mjs run client/src/__tests__/admin-ui-v1-ratchets.test.ts
 * which rewrites the JSON from the tree and REFUSES (throws, writes nothing) when any number would rise
 * or the baseline is missing or malformed. A legitimate new number (new file, wider scan, new rule) uses
 * UPDATE_RATCHET=init, with the reason in the PR body. Both modes are refused when CI is set.
 * The baseline has ZERO SLACK: it must equal the scan exactly, so a fixed violation that is not recorded
 * (run UPDATE_RATCHET=1) fails, and a hand-raised number fails whether or not the totals were raised to
 * match. A totals-only consistency test also guards the JSON against partial hand edits.
 * A deleted file leaves a stale entry that mode 1 drops; a moved file must be re-keyed by hand.
 *
 * The hunted characters are built with String.fromCharCode so this file never contains one.
 *
 * shortcut: not read, by design for W0; upgrade in the wave that needs one:
 *   - class strings built by interpolation (`text-${size}`), classNames passed in as props or imported
 *     from another file, and unquoted object-key class maps (cn({ uppercase: on }))
 *   - characters built at runtime: regex literals and String.fromCharCode
 *   - styles set as text: el.style.cssText = "..." and el.style.setProperty("transition", ...)
 *   - Tailwind line-height shorthands (text-sm/6) for smallInput
 *   - framer-motion transition durations (transition={{ duration: 0.6 }})
 *   - flag and keycap emoji, and named entities other than &mdash;
 *   - off-palette colours written as hex, rgb or oklch values instead of utilities
 */
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// jsdom gives import.meta.url an http origin, so resolve from the app root (admin-shell-contract precedent).
const APP_ROOT = process.cwd();
const BASELINE_PATH = join(APP_ROOT, "client/src/__tests__/admin-ui-v1-ratchets.baseline.json");

const COUNTERS = ["uppercase", "emDash", "emoji", "transitionAll", "slowDuration", "smallInput", "offPalette"] as const;
type Counter = (typeof COUNTERS)[number];
type Counts = Record<Counter, number>;
type Scan = Record<string, Counts>;
type Baseline = { totals: Counts; files: Record<string, Partial<Counts>> };
const zero = (): Counts => ({ uppercase: 0, emDash: 0, emoji: 0, transitionAll: 0, slowDuration: 0, smallInput: 0, offPalette: 0 });

const EM_DASH = String.fromCharCode(0x2014);
const ZWJ = 0x200d;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const SANCTIONED = new Set([0x2713, 0x25cc, 0x2757, 0x2755, 0x00d7, 0x2753, 0x2754, 0x00a9, 0x00ae, 0x2122, 0x2715]);
const MDASH_ENTITY = /&mdash;|&#0*8212;|&#[xX]0*2014;/g;
const OFF_PALETTE = /^(?:text|bg|border(?:-[tblrxyse])?|ring(?:-offset)?|from|to|via|fill|stroke|shadow|outline|accent|caret|decoration|divide|placeholder)-(?:purple|violet|indigo|pink|fuchsia|cyan|rose)-/;
const TRANSITION_ALL_TOKEN = /(?:^|:)!?(?:transition-all$|transition-\[[^\]]*\ball\b|\[transition(?:-property)?:[^\]]*\ball\b)/;
const INPUT_TAG = /^(?:input|textarea|select)$|(?:Input|Textarea|TextArea)$/;
const EXEMPT_INPUT_TYPES = new Set(["checkbox", "radio", "range", "file", "hidden", "color", "button", "submit", "reset", "image"]);

const ROOT_FILES = ["client/src/pages/Admin.tsx"];
const ROOT_DIRS = ["client/src/pages/admin", "client/src/components/admin"];
const CSS_FILES = ["client/src/index.css"];

/* ----------------------------- the instrument ----------------------------- */

function countClassTokens(text: string, c: Counts): void {
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    // Tailwind arbitrary values spell spaces as underscores ([transition:all_1s]).
    if (TRANSITION_ALL_TOKEN.test(raw.replace(/_/g, " "))) c.transitionAll++;
    const base = raw.slice(raw.lastIndexOf(":") + 1).replace(/^!/, "");
    if (base === "uppercase") c.uppercase++;
    const bare = /^duration-(\d+)$/.exec(base);
    if (bare && Number(bare[1]) > 300) c.slowDuration++;
    const arb = /^duration-\[(\d*\.?\d+)(ms|s)\]$/.exec(base);
    if (arb && Number(arb[1]) * (arb[2] === "s" ? 1000 : 1) > 300) c.slowDuration++;
    if (OFF_PALETTE.test(base)) c.offPalette++;
  }
}

function countText(text: string, c: Counts, entities: boolean): void {
  c.emDash += text.split(EM_DASH).length - 1;
  if (entities) c.emDash += (text.match(MDASH_ENTITY) ?? []).length;
  let prev = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (prev !== ZWJ && !SANCTIONED.has(cp) && PICTOGRAPH.test(ch)) c.emoji++;
    prev = cp;
  }
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => s.literal.text).join(" ");
  if (ts.isJsxExpression(node) && node.expression) return literalText(node.expression);
  return null;
}

/** Every string piece inside an expression, following same-file consts. */
function stringsIn(node: ts.Node, consts: Map<string, ts.Expression>, depth = 0): string[] {
  if (depth > 4) return [];
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    const text = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : null;
    if (text !== null) out.push(text);
    else if (ts.isIdentifier(n) && consts.has(n.text)) out.push(...stringsIn(consts.get(n.text)!, consts, depth + 1));
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function hasSmallFont(classText: string): boolean {
  return classText.split(/\s+/).some((t) => {
    if (t.includes(":")) return false;
    const tok = t.replace(/^!|!$/g, "");
    if (tok === "text-xs" || tok === "text-sm") return true;
    const m = /^text-\[(\d*\.?\d+)(px|rem|em)\]$/.exec(tok);
    return Boolean(m && Number(m[1]) < (m[2] === "px" ? 16 : 1));
  });
}

function styleIsSmall(node: ts.Node): boolean {
  let small = false;
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText().replace(/["']/g, "") === "fontSize") {
      if (ts.isNumericLiteral(n.initializer)) small ||= Number(n.initializer.text) < 16;
      const s = literalText(n.initializer);
      const m = s ? /^(\d*\.?\d+)(px|rem|em)$/.exec(s.trim()) : null;
      if (m) small ||= Number(m[1]) < (m[2] === "px" ? 16 : 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return small;
}

function isSmallInput(n: ts.JsxOpeningElement | ts.JsxSelfClosingElement, consts: Map<string, ts.Expression>): boolean {
  const tag = n.tagName.getText().split(".").pop() ?? "";
  if (!INPUT_TAG.test(tag)) return false;
  let small = false;
  for (const attr of n.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
    const name = attr.name.getText();
    if (name === "type") {
      const t = literalText(attr.initializer);
      if (t && EXEMPT_INPUT_TYPES.has(t)) return false;
    } else if (name === "className") {
      small ||= stringsIn(attr.initializer, consts).some(hasSmallFont);
    } else if (name === "style") {
      small ||= styleIsSmall(attr.initializer);
    }
  }
  return small;
}

function scanCode(source: string, fileName: string): Counts {
  const c = zero();
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const consts = new Map<string, ts.Expression>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const isTransitionKey = (name: string) => name === "transition" || name === "transitionProperty";
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      countClassTokens(n.text, c);
      countText(n.text, c, ts.isJsxAttribute(n.parent));
    } else if (ts.isJsxText(n)) {
      countText(n.text, c, true);
    } else if (ts.isPropertyAssignment(n) && isTransitionKey(n.name.getText().replace(/["']/g, ""))) {
      if (/\ball\b/.test(literalText(n.initializer) ?? "")) c.transitionAll++;
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && isTransitionKey(n.left.name.text)) {
      if (/\ball\b/.test(literalText(n.right) ?? "")) c.transitionAll++;
    }
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && isSmallInput(n, consts)) c.smallInput++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return c;
}

function scanCss(source: string): Counts {
  const c = zero();
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  c.uppercase += (css.match(/text-transform\s*:\s*uppercase/gi) ?? []).length;
  c.transitionAll += (css.match(/(?:^|[;{\s])(?:-webkit-|-moz-|-o-)?transition(?:-property)?\s*:[^;}]*\ball\b/gi) ?? []).length;
  for (const m of css.matchAll(/@apply\s+([^;}]+)/g)) countClassTokens(m[1], c);
  countText(css, c, false);
  return c;
}

function walk(root: string, rel: string, out: string[]): void {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    if (name.startsWith(".") || name === "node_modules" || name === "__tests__") continue;
    const child = `${rel}/${name}`;
    if (statSync(join(abs, name)).isDirectory()) walk(root, child, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !/\.(test|spec)\./.test(name)) out.push(child);
  }
}

function scanTree(root: string): { scan: Scan; visited: Set<string> } {
  const code = ROOT_FILES.filter((f) => existsSync(join(root, f)));
  for (const d of ROOT_DIRS) walk(root, d, code);
  const scan: Scan = {};
  for (const f of code) scan[f] = scanCode(readFileSync(join(root, f), "utf8"), f);
  for (const f of CSS_FILES) if (existsSync(join(root, f))) scan[f] = scanCss(readFileSync(join(root, f), "utf8"));
  return { scan, visited: new Set(Object.keys(scan)) };
}

/* ------------------------------ the baseline ------------------------------ */

function sumCounts(rows: Array<Partial<Counts>>): Counts {
  const t = zero();
  for (const row of rows) for (const k of COUNTERS) t[k] += row[k] ?? 0;
  return t;
}

function toBaseline(scan: Scan): Baseline {
  const files: Record<string, Partial<Counts>> = {};
  for (const file of Object.keys(scan).sort()) {
    const row: Partial<Counts> = {};
    for (const k of COUNTERS) if (scan[file][k] > 0) row[k] = scan[file][k];
    if (Object.keys(row).length > 0) files[file] = row;
  }
  return { totals: sumCounts(Object.values(files)), files };
}

function readBaseline(path: string): Baseline {
  if (!existsSync(path)) throw new Error(`ratchet baseline missing at ${path}: run UPDATE_RATCHET=init once`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const ok = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    && typeof (parsed as Baseline).totals === "object" && (parsed as Baseline).totals !== null
    && typeof (parsed as Baseline).files === "object" && (parsed as Baseline).files !== null;
  if (!ok) throw new Error(`ratchet baseline at ${path} is not { totals, files }`);
  const base = parsed as Baseline;
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  const bad = [
    ...COUNTERS.filter((k) => !isCount(base.totals[k])).map((k) => `totals.${k}`),
    ...Object.entries(base.files).flatMap(([f, row]) => Object.entries(row ?? {}).filter(([k, v]) => !COUNTERS.includes(k as Counter) || !isCount(v)).map(([k]) => `${f}.${k}`)),
  ];
  if (bad.length > 0) throw new Error(`ratchet baseline at ${path} has non-count values: ${bad.join(", ")}`);
  return base;
}

function violations(scan: Scan, visited: Set<string>, base: Baseline): string[] {
  const out: string[] = [];
  for (const [file, counts] of Object.entries(scan)) {
    for (const k of COUNTERS) {
      const allowed = base.files[file]?.[k] ?? 0;
      if (counts[k] > allowed) out.push(`${file} ${k}: ${counts[k]} > baseline ${allowed}${base.files[file] ? "" : " (file not in baseline)"}`);
    }
  }
  for (const file of Object.keys(base.files)) {
    if (!visited.has(file)) out.push(`${file}: named in the baseline but no longer scanned (deleted: UPDATE_RATCHET=1; moved: re-key by hand)`);
  }
  const totals = sumCounts(Object.values(scan));
  for (const k of COUNTERS) if (totals[k] > (base.totals[k] ?? 0)) out.push(`total ${k}: ${totals[k]} > baseline ${base.totals[k] ?? 0}`);
  return out;
}

/** UPDATE_RATCHET handling, pure over a path and env so the refusals are testable. */
function applyUpdate(mode: string, scan: Scan, path: string, env: Record<string, string | undefined>): Baseline {
  if (env.CI) throw new Error("UPDATE_RATCHET is refused when CI is set");
  const next = toBaseline(scan);
  if (mode === "1") {
    const base = readBaseline(path);
    const raises: string[] = [];
    for (const [file, row] of Object.entries(next.files)) {
      for (const k of COUNTERS) if ((row[k] ?? 0) > (base.files[file]?.[k] ?? 0)) raises.push(`${file} ${k}`);
    }
    if (raises.length > 0) throw new Error(`UPDATE_RATCHET=1 refuses to raise: ${raises.join(", ")}`);
  } else if (mode !== "init") {
    throw new Error(`UPDATE_RATCHET=${mode} is not a mode (use 1 or init)`);
  }
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/* --------------------------------- fixtures -------------------------------- */

const tempRoots: string[] = [];
afterAll(() => {
  for (const d of tempRoots) rmSync(d, { recursive: true, force: true });
});

function fixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "admin-ratchet-"));
  tempRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, "utf8");
  }
  return root;
}

const PAGE = "client/src/pages/admin/Planted.tsx";
const CSS = "client/src/index.css";
const EMOJI = String.fromCodePoint(0x1f680);
const ZWJ_FAMILY = [0x1f468, ZWJ, 0x1f469, ZWJ, 0x1f467].map((cp) => String.fromCodePoint(cp)).join("");

const PLANTED: Record<Counter, string> = {
  uppercase: `export const A = () => <span className="md:uppercase text-xs">x</span>;\n`,
  emDash: `export const A = () => <p title="a &mdash; b">plain</p>;\n`,
  emoji: `export const A = () => <p>Ready ${EMOJI}</p>;\n`,
  transitionAll: `export const A = () => <div className="hover:transition-all" />;\n`,
  slowDuration: `export const A = () => <div className="duration-500" />;\n`,
  smallInput: `const cls = "w-full text-sm";\nexport const A = () => <input className={cls} />;\n`,
  offPalette: `export const A = () => <div className="dark:bg-violet-500/20" />;\n`,
};

describe("admin UI v1 ratchet instrument", () => {
  it("scores a clean file 0 on every counter", () => {
    const root = fixtureTree({
      [PAGE]: `export const A = () => <div className="text-base bg-amber-500 transition-colors duration-200"><input className="text-base" /><input type="checkbox" className="text-xs" /></div>;\n`,
      [CSS]: `.a { transition: opacity 0.2s; text-transform: none; }\n`,
    });
    const { scan } = scanTree(root);
    expect(scan[PAGE]).toEqual(zero());
    expect(scan[CSS]).toEqual(zero());
  });

  for (const k of COUNTERS) {
    it(`fires on a planted ${k} violation and on nothing else`, () => {
      const root = fixtureTree({ [PAGE]: PLANTED[k] });
      const counts = scanTree(root).scan[PAGE];
      expect(counts[k]).toBe(1);
      for (const o of COUNTERS.filter((x) => x !== k)) expect(counts[o], `${o} in the ${k} fixture`).toBe(0);
    });
  }

  it("reads the other spellings: raw em dash, numeric entity, inline transition, style fontSize, arbitrary duration", () => {
    const root = fixtureTree({
      [PAGE]: [
        `export const A = () => <div>`,
        `  <p>one ${EM_DASH} two &#8212; three</p>`,
        `  <div style={{ transition: "all 0.3s" }} className="duration-[0.5s] [transition:all_1s]" />`,
        `  <textarea style={{ fontSize: 13 }} />`,
        `  <SearchInput className="text-[14px]" />`,
        `</div>;`,
        `export function f(el: HTMLElement) { el.style.transition = "all 2s"; }`,
      ].join("\n"),
    });
    const counts = scanTree(root).scan[PAGE];
    expect(counts.emDash).toBe(2);
    expect(counts.transitionAll).toBe(3);
    expect(counts.slowDuration).toBe(1);
    expect(counts.smallInput).toBe(2);
  });

  it("reads the Tailwind v4 and iOS spellings: ! suffix, side borders, ring-offset, caret, select", () => {
    const root = fixtureTree({
      [PAGE]: [
        `export const A = () => <div>`,
        `  <div className="bg-violet-500!" />`,
        `  <div className="border-t-pink-400" />`,
        `  <div className="md:border-x-indigo-300" />`,
        `  <div className="ring-offset-cyan-300" />`,
        `  <div className="caret-rose-500" />`,
        `  <select className="text-sm" />`,
        `  <input className="w-full text-xs!" />`,
        `  <select className="text-base" />`,
        `</div>;`,
      ].join("\n"),
    });
    const counts = scanTree(root).scan[PAGE];
    expect(counts).toEqual({ ...zero(), offPalette: 5, smallInput: 2 });
  });

  it("never counts comments, sanctioned glyphs, or a ZWJ sequence more than once", () => {
    const glyphs = [0x2713, 0x25cc, 0x00d7, 0x00a9, 0x00ae, 0x2122, 0x2715].map((cp) => String.fromCodePoint(cp)).join(" ");
    const root = fixtureTree({
      [PAGE]: [
        `// uppercase transition-all ${EM_DASH} ${EMOJI} bg-purple-500 duration-700`,
        `/* className="uppercase" ${EM_DASH} */`,
        `export const A = () => <div>{/* ${EM_DASH} ${EMOJI} */}<p>${glyphs}</p><p>${ZWJ_FAMILY}</p></div>;`,
      ].join("\n"),
      [CSS]: `/* ${EM_DASH} transition: all 1s; text-transform: uppercase */\n.a { color: red; }\n`,
    });
    const { scan } = scanTree(root);
    expect(scan[PAGE]).toEqual({ ...zero(), emoji: 1 });
    expect(scan[CSS]).toEqual(zero());
  });

  it("reads CSS outside comments: text-transform, transition all, @apply tokens, em dash, emoji", () => {
    const root = fixtureTree({
      [CSS]: [
        `.a { text-transform: uppercase; transition: all 0.6s ease; }`,
        `.b { -webkit-transition-property: all; }`,
        `.c { @apply uppercase duration-700 text-pink-400; }`,
        `.d::after { content: "${EM_DASH} ${EMOJI}"; }`,
      ].join("\n"),
    });
    expect(scanTree(root).scan[CSS]).toEqual({ ...zero(), uppercase: 2, transitionAll: 2, slowDuration: 1, offPalette: 1, emDash: 1, emoji: 1 });
  });

  it("walks the real tree: visits Admin.tsx, registry.tsx and index.css, skips tests", () => {
    const { visited } = scanTree(APP_ROOT);
    expect(visited.has("client/src/pages/Admin.tsx")).toBe(true);
    expect(visited.has("client/src/pages/admin/registry.tsx")).toBe(true);
    expect(visited.has("client/src/components/admin/DegradedDataBanner.tsx")).toBe(true);
    expect(visited.has("client/src/index.css")).toBe(true);
    expect([...visited].some((f) => f.includes("__tests__") || /\.test\./.test(f))).toBe(false);
    expect(visited.size).toBeGreaterThan(100);
  });

  it("every counter rises when a violation is planted into a copy of the real Admin.tsx", () => {
    const real = scanTree(APP_ROOT).scan["client/src/pages/Admin.tsx"];
    const root = mkdtempSync(join(tmpdir(), "admin-ratchet-real-"));
    tempRoots.push(root);
    const rel = "client/src/pages/Admin.tsx";
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(APP_ROOT, rel), join(root, rel));
    const planted = Object.values(PLANTED).map((src, i) => src.replace(/\bA\b/g, `Planted${i}`).replace(/\bcls\b/g, `plantedCls${i}`)).join("");
    writeFileSync(join(root, rel), readFileSync(join(root, rel), "utf8") + "\n" + planted, "utf8");
    const after = scanTree(root).scan[rel];
    for (const k of COUNTERS) expect(after[k], k).toBeGreaterThan(real[k]);
  });
});

describe("admin UI v1 ratchet baseline mechanics", () => {
  const scanOf = (n: number): Scan => ({ "client/src/pages/admin/X.tsx": { ...zero(), uppercase: n } });

  it("init creates, 1 lowers, 1 refuses a raise and writes nothing, CI refuses both", () => {
    const dir = mkdtempSync(join(tmpdir(), "admin-ratchet-base-"));
    tempRoots.push(dir);
    const path = join(dir, "baseline.json");
    expect(() => applyUpdate("1", scanOf(2), path, {})).toThrow(/missing/);
    applyUpdate("init", scanOf(3), path, {});
    expect(readBaseline(path).totals.uppercase).toBe(3);
    applyUpdate("1", scanOf(2), path, {});
    expect(readBaseline(path).files["client/src/pages/admin/X.tsx"]).toEqual({ uppercase: 2 });
    expect(() => applyUpdate("1", scanOf(5), path, {})).toThrow(/refuses to raise/);
    expect(readBaseline(path).totals.uppercase).toBe(2);
    expect(() => applyUpdate("init", scanOf(9), path, { CI: "true" })).toThrow(/CI/);
    expect(() => applyUpdate("1", scanOf(1), path, { CI: "1" })).toThrow(/CI/);
    expect(readBaseline(path).totals.uppercase).toBe(2);
    writeFileSync(path, "[]", "utf8");
    expect(() => readBaseline(path)).toThrow(/not \{ totals, files \}/);
    writeFileSync(path, JSON.stringify({ totals: zero(), files: { "a.tsx": { emoji: null } } }), "utf8");
    expect(() => readBaseline(path)).toThrow(/non-count values: a\.tsx\.emoji/);
  });

  it("flags a rise, a new file with hits, and a baseline entry the scan no longer visits", () => {
    const base = toBaseline({ "a.tsx": { ...zero(), emoji: 1 }, "gone.tsx": { ...zero(), emDash: 1 } });
    const scan: Scan = { "a.tsx": { ...zero(), emoji: 2 }, "new.tsx": { ...zero(), offPalette: 1 } };
    const v = violations(scan, new Set(Object.keys(scan)), base);
    expect(v.some((s) => s.startsWith("a.tsx emoji"))).toBe(true);
    expect(v.some((s) => s.startsWith("new.tsx offPalette") && s.includes("not in baseline"))).toBe(true);
    expect(v.some((s) => s.startsWith("gone.tsx"))).toBe(true);
    expect(violations({ "a.tsx": { ...zero(), emoji: 1 } }, new Set(["a.tsx", "gone.tsx"]), base)).toEqual([]);
  });
});

describe("admin UI v1 ratchet", () => {
  const mode = process.env.UPDATE_RATCHET;

  it("the admin tree does not exceed the committed baseline", () => {
    const { scan, visited } = scanTree(APP_ROOT);
    if (mode) {
      const written = applyUpdate(mode, scan, BASELINE_PATH, process.env);
      console.info(`[admin-ui-v1-ratchets] UPDATE_RATCHET=${mode} wrote totals ${JSON.stringify(written.totals)}`);
      return;
    }
    expect(violations(scan, visited, readBaseline(BASELINE_PATH))).toEqual([]);
  });

  it("the committed baseline equals the scan exactly (zero slack)", () => {
    if (mode) return;
    const { scan } = scanTree(APP_ROOT);
    const base = readBaseline(BASELINE_PATH);
    const fresh = toBaseline(scan);
    const hint = "a count went down: run UPDATE_RATCHET=1 and commit the lowered baseline";
    expect(base.files, `per-file counts differ from the scan (${hint}; a count that went UP fails the test above)`).toEqual(fresh.files);
    expect(base.totals, `totals differ from the scan (${hint})`).toEqual(fresh.totals);
  });

  it("the baseline totals equal the sum of its files (guards partial hand edits of the JSON)", () => {
    const base = readBaseline(BASELINE_PATH);
    expect(base.totals).toEqual(sumCounts(Object.values(base.files)));
  });
});
