/**
 * UI v3 ratchets (Wave 0, 2026-10-15, docs/design/ui-v3/PLAN.md).
 *
 * Six UI-grammar counters over the rendered source, with a per-file baseline in
 * ui-v3-ratchets.baseline.json. W0 changes no class name anywhere: the baseline RECORDS today's
 * violations, and the test fails when a file goes above its number, when a file the baseline has
 * never seen has any, when a total rises, or when the baseline names a file the scan no longer
 * visits. Later waves lower the baseline.
 *
 * Scan scope (app-root-relative POSIX keys): every non-test .ts and .tsx under components/,
 * features/, hooks/ and app/ (NOT app/api), every .css under app/, and exactly two lib modules that
 * render UI text: lib/floating-home/smart-now.ts and lib/mastery/config.ts. The rest of lib/ (AI
 * prompts, logs) is noise and is not scanned. .d.ts, *.test.*, *.spec.*, __tests__, node_modules and
 * dot-directories are skipped.
 *
 *   uppercase      the `uppercase` class token (any variant prefix) in a string or template literal,
 *                  as an identifier or shorthand key of an object passed to cn/clsx/cx/classNames/
 *                  cva/tv/twMerge/twJoin, `text-transform: uppercase` in CSS, and `@apply uppercase`.
 *                  The baseline records the five sanctioned CSS roles in app/styles (.section-label,
 *                  .text-eyebrow and three more in base.css); W1 allowlists them.
 *   emDash         U+2014 in a string literal, template literal or JSX text, plus the entity forms
 *                  JSX decodes (&mdash; and numeric spellings, leading zeros included) in JSX text and
 *                  JSX attribute strings. Comments never count.
 *   emoji          \p{Extended_Pictographic}, regional-indicator flag pairs and keycap sequences in a
 *                  string, template or JSX text (numeric entities decoded where JSX decodes them), one
 *                  per ZWJ sequence, minus the status glyphs docs/design/ui-v2/SYSTEM.md section 9
 *                  sanctions and the copyright, registered and trademark signs (legal footers)
 *   transitionAll  the `transition-all` utility, `transition-[...]` and `[transition:...]` arbitrary
 *                  forms that name `all`, and any `transition` or `transition-property` declaration
 *                  (vendor prefixes too) that lists `all` anywhere in its value, in those literals, in
 *                  an inline style or `el.style.transition = ...` assignment (string or template), and
 *                  in CSS. One count per declaration.
 *   slowDuration   a Tailwind duration class over 300 ms: a bare number (duration-500) or an arbitrary
 *                  value in ms or s (400ms, 0.5s), also inside CSS @apply
 *   smallInput     an input or textarea element (also Input, Textarea, TextArea and any name ending in
 *                  Input, Textarea or TextArea, dotted names like CommandPrimitive.Input included)
 *                  whose own className sets an unprefixed font size under 16px (text-xs, text-sm, or an
 *                  arbitrary px, rem, em or % size) or whose inline style sets fontSize under 16px.
 *                  iOS Safari zooms the page on focus under 16px. Checkbox, radio, range, file, hidden,
 *                  color and button types are exempt. A className held in a same-file const is read.
 *
 * Lower the baseline after a wave removes violations (bash, then PowerShell):
 *   UPDATE_RATCHET=1 pnpm exec vitest run tests/repo/ui-v3-ratchets.test.ts
 *   $env:UPDATE_RATCHET='1'; pnpm exec vitest run tests/repo/ui-v3-ratchets.test.ts
 * Mode 1 rewrites the JSON from the tree and REFUSES (throws, writes nothing) if any number would
 * rise OR if the baseline file is missing. UPDATE_RATCHET=init is the only mode that may create or
 * raise the baseline; it exists for widening the scan and is used once, in review, never to silence a
 * regression. Never hand-edit a number up; the consistency test fails when totals stop matching. A file
 * that moves or is renamed arrives with no baseline entry and leaves a stale one behind, so re-key its
 * entry by hand: the numbers move with it and the totals do not change.
 *
 * The instrument can fail: every counter has a planted-violation fixture written to a temp dir and
 * read back through the same scanTree the real run uses, a clean fixture scores 0, and the walker is
 * proven to visit named stable files, so a zero cannot mean "scanned nothing".
 *
 * This file builds the characters it hunts (em dash, emoji, flags, keycaps, legal marks) with
 * String.fromCharCode and String.fromCodePoint on purpose: a literal one, or a unicode escape the tool
 * layer decodes, would put the violation in the instrument's own source.
 *
 * shortcut: class strings built by interpolation (`text-${size}`), a className imported from another
 * file or passed down as a prop, a `max-md:` variant that sets a phone size, `<select>`, and a
 * transition value split across a template substitution are not read. Two consts with the same name in
 * one file resolve to the later one. A false positive (the word "uppercase" in prose) is baselined
 * like any other and costs one number.
 */
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const BASELINE_PATH = join(__dirname, "ui-v3-ratchets.baseline.json");

/* ----------------------------- the instrument ----------------------------- */

export const COUNTERS = ["uppercase", "emDash", "emoji", "transitionAll", "slowDuration", "smallInput"] as const;
export type Counter = (typeof COUNTERS)[number];
export type Counts = Record<Counter, number>;
/** App-root-relative POSIX path -> counts. */
export type Scan = Record<string, Counts>;
export const zero = (): Counts => ({ uppercase: 0, emDash: 0, emoji: 0, transitionAll: 0, slowDuration: 0, smallInput: 0 });

const EM_DASH = String.fromCharCode(0x2014);
const ZWJ = 0x200d;
const KEYCAP = 0x20e3;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
/**
 * Never counted as emoji. SYSTEM.md section 9 status glyphs: check mark, open circle, exclamation,
 * multiplication sign, question mark. Then the copyright, registered and trademark signs, which Unicode
 * calls pictographic but a legitimate footer is entitled to.
 */
const SANCTIONED_GLYPHS = new Set([0x2713, 0x25cc, 0x21, 0xd7, 0x3f, 0xa9, 0xae, 0x2122]);

const UPPERCASE = /(?<![\w-])uppercase(?![\w-])/g;
const TRANSITION_UTILITY = /(?<![\w-])transition-all(?![\w-])/g;
/** transition-[all], transition-[all_.2s]: group 1 is the bracket body. */
const TRANSITION_ARBITRARY = /(?<![\w-])transition-\[([^\]]*)\]/g;
/** [transition:all_.2s], [transition-property:opacity,all]: group 1 is the value. */
const TRANSITION_ARBITRARY_PROP = /(?<![\w-])\[(?:-(?:webkit|moz|ms|o)-)?transition(?:-property)?:([^\]]*)\]/g;
/** Group 1 is the declaration's value, up to the next `;`, brace or `]` (it may span lines). Not inside [...]. */
const TRANSITION_DECL = /(?<![\w[-])(?:-(?:webkit|moz|ms|o)-)?transition(?:-property)?\s*:\s*([^;{}\]]*)/g;
const TRANSITION_KEY = /^(?:webkit|moz|ms|o)?transition(?:property)?$/i;
const DURATION_N = /(?<![\w-])duration-(\d+)(?![\w-])/g;
const DURATION_MS = /(?<![\w-])duration-\[(\d*\.?\d+)(ms|s)\](?![\w-])/g;
const CSS_UPPERCASE_DECL = /(?<![\w-])text-transform\s*:\s*uppercase(?![\w-])/g;
const CSS_APPLY = /@apply\s+([^;}]*)/g;
const SLOW_MS = 300;
const PHONE_FLOOR_PX = 16;

const INPUT_TAG = /^(?:input|textarea)$|(?:^|\.)[A-Za-z0-9_]*(?:Input|Textarea|TextArea)$/;
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "range", "file", "hidden", "color", "submit", "button", "reset", "image"]);
const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "classNames", "classnames", "cva", "tv", "twMerge", "twJoin"]);

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
const countChar = (s: string, ch: string) => s.split(ch).length - 1;
const unitPx = (n: number, unit: string) => n * (unit === "px" ? 1 : unit === "%" ? 0.16 : 16);

/** What JSX renders for the entities it decodes: &mdash; and numeric &#...; / &#x...; (leading zeros allowed). */
export function decodeEntities(s: string): string {
  return s.replace(/&(mdash);|&#(?:x([0-9a-f]+)|(\d+));/gi, (whole, named: string | undefined, hex: string | undefined, dec: string | undefined) => {
    if (named) return EM_DASH;
    const cp = hex ? parseInt(hex, 16) : parseInt(dec as string, 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
}

/**
 * Pictographs in a string, one per ZWJ sequence, one per flag pair, one per keycap, minus the sanctioned
 * glyphs. The predicate is a parameter only so a test can prove the exclusion holds even if a Unicode
 * update reclassifies a glyph.
 */
export function countEmoji(s: string, isPictograph: (ch: string) => boolean = (ch) => PICTOGRAPH.test(ch)): number {
  let n = 0;
  let afterJoiner = false;
  let halfFlag = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === ZWJ) {
      afterJoiner = true;
      continue;
    }
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      if (halfFlag) halfFlag = false;
      else {
        n++;
        halfFlag = true;
      }
      afterJoiner = false;
      continue;
    }
    halfFlag = false;
    if (cp === KEYCAP) n++;
    else if (isPictograph(ch) && !SANCTIONED_GLYPHS.has(cp) && !afterJoiner) n++;
    afterJoiner = false;
  }
  return n;
}

/** True when a transition value lists `all` anywhere: `all .2s`, `.3s all`, `opacity 1s, all 2s`, `opacity,all`. */
const listsAll = (value: string) => value.split(/[\s,]+/).includes("all");
/** Same for a Tailwind arbitrary value, where `_` stands for a space. */
const listsAllUtility = (value: string) => value.split(/[\s,_]+/).includes("all");

/** The `transition-all` utility, its arbitrary forms, and one per `transition` / `transition-property` declaration that lists `all`. */
function countTransitionAll(text: string): number {
  let n = count(TRANSITION_UTILITY, text);
  for (const m of text.matchAll(TRANSITION_ARBITRARY)) if (listsAllUtility(m[1])) n++;
  for (const m of text.matchAll(TRANSITION_ARBITRARY_PROP)) if (listsAllUtility(m[1])) n++;
  for (const m of text.matchAll(TRANSITION_DECL)) if (listsAll(m[1])) n++;
  return n;
}

function countSlowDurations(s: string): number {
  let n = 0;
  for (const m of s.matchAll(DURATION_N)) if (Number(m[1]) > SLOW_MS) n++;
  for (const m of s.matchAll(DURATION_MS)) if (parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1) > SLOW_MS) n++;
  return n;
}

/**
 * True when a class list sets an unprefixed font size under 16px. The pattern is anchored at `text-`, so a
 * variant (md:, hover:, max-md:) never matches: only the size the phone gets without a breakpoint counts.
 */
function smallBaseSize(classText: string): boolean {
  for (const raw of classText.split(/\s+/)) {
    const token = raw.replace(/^!/, "").replace(/!$/, "");
    const m = /^text-(?:(xs|sm)|\[(\d*\.?\d+)(px|rem|em|%)\])(?:\/\S+)?$/.exec(token);
    if (!m) continue;
    if (m[1]) return true;
    if (unitPx(parseFloat(m[2]), m[3]) < PHONE_FLOOR_PX) return true;
  }
  return false;
}

type Stringish = ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;
const isStringish = (n: ts.Node): n is Stringish =>
  ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);

/** An identifier that reads a value, not the name side of `a.name` or `{ name: 1 }`. */
const isValueReference = (id: ts.Identifier) =>
  !((ts.isPropertyAccessExpression(id.parent) && id.parent.name === id) || (ts.isPropertyAssignment(id.parent) && id.parent.name === id));

/** `foo`, `"foo"` and `["foo"]` as an object key. */
function propertyKeyText(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return "";
}

/** The text of a transition value written as a string or a template (substitutions leave gaps). */
function transitionValue(init: ts.Node): string {
  if (ts.isStringLiteralLike(init)) return init.text;
  if (ts.isTemplateExpression(init)) return [init.head.text, ...init.templateSpans.map((s) => s.literal.text)].join(" ");
  return "";
}

/** An object literal passed straight to cn/clsx/cx/classNames/cva/tv/twMerge/twJoin. */
function isClassHelperArg(obj: ts.ObjectLiteralExpression): boolean {
  const call = obj.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(obj)) return false;
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  return CLASS_HELPERS.has(name);
}

/** Every string piece inside an attribute value, following same-file const identifiers one hop at a time. */
function classPieces(expr: ts.Node, consts: Map<string, ts.Node>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  (function visit(n: ts.Node): void {
    if (isStringish(n)) out.push(n.text);
    else if (ts.isIdentifier(n) && isValueReference(n)) {
      const init = consts.get(n.text);
      if (init && !seen.has(n.text)) {
        seen.add(n.text);
        visit(init);
      }
    }
    ts.forEachChild(n, visit);
  })(expr);
  return out;
}

/** style={{ fontSize: 13 }} or fontSize: "0.75rem": true when the inline size is under 16px. */
function styleFontSmall(style: ts.Node | undefined): boolean {
  if (!style || !ts.isJsxExpression(style) || !style.expression || !ts.isObjectLiteralExpression(style.expression)) return false;
  for (const p of style.expression.properties) {
    if (!ts.isPropertyAssignment(p) || propertyKeyText(p.name) !== "fontSize") continue;
    let px: number | null = null;
    if (ts.isNumericLiteral(p.initializer)) px = Number(p.initializer.text);
    else if (ts.isStringLiteralLike(p.initializer)) {
      const m = /^(\d*\.?\d+)(px|rem|em|%)$/.exec(p.initializer.text.trim());
      if (m) px = unitPx(parseFloat(m[1]), m[2]);
    }
    if (px !== null && px < PHONE_FLOOR_PX) return true;
  }
  return false;
}

function isSmallInput(el: ts.JsxOpeningLikeElement, consts: Map<string, ts.Node>, sf: ts.SourceFile): boolean {
  if (!INPUT_TAG.test(el.tagName.getText(sf))) return false;
  const attr = (name: string) =>
    el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === name)?.initializer;
  const type = attr("type");
  const staticType =
    type && ts.isStringLiteral(type)
      ? type.text
      : type && ts.isJsxExpression(type) && type.expression && ts.isStringLiteralLike(type.expression)
        ? type.expression.text
        : null;
  if (staticType !== null && NON_TEXT_INPUT_TYPES.has(staticType)) return false;
  const cls = attr("className");
  return (cls ? smallBaseSize(classPieces(cls, consts).join(" ")) : false) || styleFontSmall(attr("style"));
}

/** `x.style.transition = ...` or `x.style["transition"] = ...`: the key and whether the object is a `.style`. */
function styleAssignmentKey(left: ts.Expression): string {
  const onStyle = (obj: ts.Expression) => ts.isPropertyAccessExpression(obj) && obj.name.text === "style";
  if (ts.isPropertyAccessExpression(left) && onStyle(left.expression)) return left.name.text;
  if (ts.isElementAccessExpression(left) && onStyle(left.expression) && ts.isStringLiteralLike(left.argumentExpression)) return left.argumentExpression.text;
  return "";
}

/** Counts for one source file. `tsx` false parses as plain TypeScript (generic arrows, no JSX). */
export function scanSource(text: string, tsx: boolean): Counts {
  const sf = ts.createSourceFile(tsx ? "scan.tsx" : "scan.ts", text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const c = zero();
  const consts = new Map<string, ts.Node>();
  (function collect(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  })(sf);

  (function visit(n: ts.Node): void {
    if (isStringish(n)) {
      const s = n.text;
      // JSX decodes entities in attribute strings and text, a plain JS string shows them literally.
      const rendered = ts.isStringLiteral(n) && ts.isJsxAttribute(n.parent) ? decodeEntities(s) : s;
      c.uppercase += count(UPPERCASE, s);
      c.transitionAll += countTransitionAll(s);
      c.slowDuration += countSlowDurations(s);
      c.emDash += countChar(rendered, EM_DASH);
      c.emoji += countEmoji(rendered);
    } else if (ts.isJsxText(n)) {
      const rendered = decodeEntities(n.text);
      c.emDash += countChar(rendered, EM_DASH);
      c.emoji += countEmoji(rendered);
    } else if (ts.isPropertyAssignment(n)) {
      // style={{ transition: "opacity 1s, all 2s" }}: the string alone carries no `transition:` for the regex.
      if (TRANSITION_KEY.test(propertyKeyText(n.name)) && listsAll(transitionValue(n.initializer))) c.transitionAll++;
      // clsx("x", { uppercase: on }): an unquoted key is invisible to the string scan.
      if (ts.isIdentifier(n.name) && n.name.text === "uppercase" && ts.isObjectLiteralExpression(n.parent) && isClassHelperArg(n.parent)) c.uppercase++;
    } else if (ts.isShorthandPropertyAssignment(n)) {
      if (n.name.text === "uppercase" && ts.isObjectLiteralExpression(n.parent) && isClassHelperArg(n.parent)) c.uppercase++;
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (TRANSITION_KEY.test(styleAssignmentKey(n.left)) && listsAll(transitionValue(n.right))) c.transitionAll++;
    } else if (ts.isJsxOpeningLikeElement(n)) {
      if (isSmallInput(n, consts, sf)) c.smallInput++;
    }
    ts.forEachChild(n, visit);
  })(sf);
  return c;
}

export const scanTsx = (text: string): Counts => scanSource(text, true);
export const scanTs = (text: string): Counts => scanSource(text, false);

export function scanCss(text: string): Counts {
  const c = zero();
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, "");
  c.transitionAll = countTransitionAll(bare);
  c.uppercase = count(CSS_UPPERCASE_DECL, bare);
  for (const m of bare.matchAll(CSS_APPLY)) {
    c.uppercase += count(UPPERCASE, m[1]);
    c.slowDuration += countSlowDurations(m[1]);
  }
  return c;
}

export const scanFile = (rel: string, text: string): Counts =>
  rel.endsWith(".css") ? scanCss(text) : scanSource(text, !rel.endsWith(".ts"));

/* ------------------------------- the walker ------------------------------- */

const SOURCE_ROOTS = ["app", "components", "features", "hooks"] as const;
/** The only lib modules scanned: UI text lives in them. The rest of lib/ is prompts and logs. */
const EXTRA_FILES = ["lib/floating-home/smart-now.ts", "lib/mastery/config.ts"] as const;

const isSourceName = (name: string) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts");

function walk(appRoot: string, rel: string, out: string[]): void {
  const dir = join(appRoot, rel);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const childRel = `${rel}/${name}`;
    if (childRel === "app/api") continue;
    if (statSync(join(appRoot, childRel)).isDirectory()) walk(appRoot, childRel, out);
    else if (isSourceName(name) || (childRel.startsWith("app/") && name.endsWith(".css"))) out.push(childRel);
  }
}

/** Sorted app-root-relative POSIX paths of everything the ratchets read (see the header for the scope). */
export function listSourceFiles(appRoot: string): string[] {
  const out: string[] = [];
  for (const root of SOURCE_ROOTS) walk(appRoot, root, out);
  for (const extra of EXTRA_FILES) if (existsSync(join(appRoot, extra))) out.push(extra);
  return [...new Set(out)].sort();
}

export function scanTree(appRoot: string): Scan {
  const out: Scan = {};
  for (const rel of listSourceFiles(appRoot)) out[rel] = scanFile(rel, readFileSync(join(appRoot, rel), "utf8"));
  return out;
}

/* ---------------------------- baseline and rules --------------------------- */

export interface Baseline {
  totals: Counts;
  files: Record<string, Partial<Counts>>;
}

const ABOUT =
  "UI v3 ratchet baseline (tests/repo/ui-v3-ratchets.test.ts). Keys are app-root-relative POSIX paths; a file or counter that is absent is 0. " +
  "A count may fall and never rise. Lower the numbers with UPDATE_RATCHET=1 pnpm exec vitest run tests/repo/ui-v3-ratchets.test.ts, which refuses to raise any number and refuses a missing file. " +
  "UPDATE_RATCHET=init may create or raise the baseline; it is for widening the scan, once, in review. " +
  "Do not hand-edit a number up; a moved, renamed or deleted file is re-keyed or dropped by hand or by mode 1, its numbers moving with it and the totals unchanged.";

export function sumTotals(scan: Scan): Counts {
  const t = zero();
  for (const counts of Object.values(scan)) for (const k of COUNTERS) t[k] += counts[k];
  return t;
}

export function toBaseline(scan: Scan): Baseline {
  const files: Record<string, Partial<Counts>> = {};
  for (const rel of Object.keys(scan).sort()) {
    const nonZero: Partial<Counts> = {};
    for (const k of COUNTERS) if (scan[rel][k] > 0) nonZero[k] = scan[rel][k];
    if (Object.keys(nonZero).length > 0) files[rel] = nonZero;
  }
  return { totals: sumTotals(scan), files };
}

/** Every way the scan goes above the baseline: one file's counter, or one counter's total. Empty means held. */
export function risen(scan: Scan, baseline: Baseline): string[] {
  const out: string[] = [];
  for (const rel of Object.keys(scan).sort()) {
    for (const k of COUNTERS) {
      const base = baseline.files?.[rel]?.[k] ?? 0;
      if (scan[rel][k] > base) out.push(`${rel}: ${k} ${scan[rel][k]} > baseline ${base}`);
    }
  }
  const total = sumTotals(scan);
  for (const k of COUNTERS) {
    const base = baseline.totals?.[k] ?? 0;
    if (total[k] > base) out.push(`TOTAL ${k}: ${total[k]} > baseline ${base}`);
  }
  return out;
}

/** What is wrong with the baseline file itself. Empty means it is well formed and its totals match its files. */
export function baselineProblems(b: Baseline): string[] {
  const out: string[] = [];
  const sum = zero();
  for (const [rel, counts] of Object.entries(b.files ?? {})) {
    if (rel.includes("\\")) out.push(`${rel}: not a POSIX path`);
    for (const [k, v] of Object.entries(counts)) {
      if (!(COUNTERS as readonly string[]).includes(k)) out.push(`${rel}: unknown counter ${k}`);
      else if (!Number.isInteger(v) || (v as number) <= 0) out.push(`${rel}: ${k} must be a positive integer, got ${String(v)}`);
      else sum[k as Counter] += v as number;
    }
  }
  for (const k of COUNTERS) if (b.totals?.[k] !== sum[k]) out.push(`totals.${k} is ${String(b.totals?.[k])} but the files sum to ${sum[k]}`);
  return out;
}

/** Baseline keys the scan no longer visits (deleted, moved, or renamed files). A stale key is borrowed allowance. */
export function staleKeys(b: Baseline, visited: string[]): string[] {
  const seen = new Set(visited);
  return Object.keys(b.files ?? {}).filter((rel) => !seen.has(rel));
}

export function planUpdate(prev: Baseline | null, scan: Scan): { next: Baseline; raised: string[] } {
  return { next: toBaseline(scan), raised: prev ? risen(scan, prev) : [] };
}

export const serialize = (b: Baseline): string =>
  `${JSON.stringify({ _about: ABOUT, totals: b.totals, files: b.files }, null, 2)}\n`;

export type UpdateMode = "lower" | "init";
/** UPDATE_RATCHET=1 is "lower", UPDATE_RATCHET=init is "init", anything else is no update. */
export const updateMode = (env: string | undefined): UpdateMode | null => (env === "1" ? "lower" : env === "init" ? "init" : null);

/**
 * "lower" (UPDATE_RATCHET=1): write the baseline from the scan, or throw and write nothing if any number
 * would rise or the file is missing. "init" (UPDATE_RATCHET=init): create or overwrite without the check.
 */
export function applyUpdate(path: string, scan: Scan, mode: UpdateMode = "lower"): Baseline {
  const exists = existsSync(path);
  if (!exists && mode === "lower") {
    throw new Error("UPDATE_RATCHET=1 refuses to create a baseline: the file is missing (restore it from git). UPDATE_RATCHET=init is for widening the scan, once.");
  }
  const prev = exists && mode === "lower" ? (JSON.parse(readFileSync(path, "utf8")) as Baseline) : null;
  const { next, raised } = planUpdate(prev, scan);
  if (raised.length > 0) throw new Error(`UPDATE_RATCHET refuses to raise a number:\n  ${raised.join("\n  ")}`);
  writeFileSync(path, serialize(next));
  return next;
}

/* --------------------------------- fixtures -------------------------------- */

const GRIN = String.fromCodePoint(0x1f600);
const FAMILY = String.fromCodePoint(0x1f469, ZWJ, 0x1f467);
const FLAG = String.fromCodePoint(0x1f1ea, 0x1f1f8);
const KEYCAP_ONE = String.fromCodePoint(0x31, 0xfe0f, KEYCAP);
const HEAVY_CHECK = String.fromCharCode(0x2714); // an emoji; the plain check mark below is not
const CHECK = String.fromCharCode(0x2713);
const CIRCLE = String.fromCharCode(0x25cc);
const TIMES = String.fromCharCode(0xd7);
const LEGAL_MARKS = [0xa9, 0xae, 0x2122].map((cp) => String.fromCharCode(cp)); // copyright, registered, trademark
const EN_DASH = String.fromCharCode(0x2013);
const BACKSLASH = String.fromCharCode(92);
const GLYPHS: Record<string, string> = {
  "<D>": EM_DASH,
  "<GRIN>": GRIN,
  "<FAMILY>": FAMILY,
  "<FLAG>": FLAG,
  "<KEYCAP>": KEYCAP_ONE,
  "<HEAVYCHECK>": HEAVY_CHECK,
  "<WARN>": String.fromCharCode(0x26a0),
  "<CHECK>": CHECK,
  "<CIRCLE>": CIRCLE,
  "<TIMES>": TIMES,
  "<COPY>": LEGAL_MARKS[0],
  "<REG>": LEGAL_MARKS[1],
  "<TM>": LEGAL_MARKS[2],
};

const madeDirs: string[] = [];
function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ui-v3-ratchet-"));
  madeDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    let text = body;
    for (const [token, glyph] of Object.entries(GLYPHS)) text = text.replaceAll(token, glyph);
    writeFileSync(abs, text);
  }
  return dir;
}
afterAll(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

/** One planted file per rule family, each holding exactly the counts it promises (everything else 0). */
const PLANTED: Record<string, { counts: Partial<Counts>; src: string }> = {
  "components/planted-uppercase.tsx": {
    counts: { uppercase: 7 },
    src: [
      'export const A = () => <p className="font-mono uppercase tracking-wide">a</p>;', // 1
      'export const B = () => <p className={cn("x", on && "md:uppercase")}>b</p>;', // 2 (variant prefix)
      "export const C = { textTransform: 'uppercase' };", // 3 (inline style value)
      'export const D = () => <p className="normal-case uppercase-none no-uppercase lowercase">d</p>;', // near misses: 0
      'export const E = clsx("x", { uppercase: on });', // 4 an unquoted key is a class
      'export const F = cn("y", { uppercase });', // 5 shorthand key
      'export const G = cva("base", { uppercase: on });', // 6
      "export const H = cn(\"x\", { 'uppercase': on });", // 7 a quoted key is just a string
      "export const I = { uppercase: true };", // 0 not a class helper
      'export const J = foo("x", { uppercase: on });', // 0 not a class helper
    ].join("\n"),
  },
  "components/planted-emdash.tsx": {
    counts: { emDash: 14 },
    src: [
      'export const a = "x<D>y";', // 1 string literal
      "export const b = `t<D>${a}`;", // 2 template head
      'export const c = () => <p title="p<D>q">r</p>;', // 3 JSX attribute string
      "export const d = () => <p>one <D> two</p>;", // 4 JSX text
      'export const e = () => <p>{"s<D>t"}</p>;', // 5 string inside an expression
      "export const f = () => <p>left &mdash; right</p>;", // 6 the entity JSX renders as an em dash
      "export const g = () => <p>a &#8212; b &#x2014; c</p>;", // 7, 8 numeric and hex spellings of it
      'export const h = () => <p title="x &mdash; y">z</p>;', // 9 JSX decodes entities in attribute strings too
      "export const i = `${a}<D>${a}<D>`;", // 10, 11 template middle and tail
      "export const l = () => <p>a &#x02014; b &#08212; c</p>;", // 12, 13 leading zeros
      'export const n = () => <p title="a &#x2014; b">z</p>;', // 14 numeric entity in an attribute
      "export const j = 'literal &mdash; and &#x2014; in a plain string';", // a plain JS string shows the entity as text: 0
      "// comment <D> here",
      "/* block <D> here */",
      "export const k = () => <p>{/* jsx <D> comment */}ok</p>;",
    ].join("\n"),
  },
  "components/planted-emoji.tsx": {
    counts: { emoji: 12 },
    src: [
      'export const a = "hello <GRIN>";', // 1
      "export const b = () => <p>done <HEAVYCHECK></p>;", // 2 the heavy check mark is an emoji, the plain check is not
      "export const c = `warn <WARN> ${a}`;", // 3
      'export const d = () => <span title="fam <FAMILY>">x</span>;', // 4 one ZWJ sequence counts once
      "export const e = () => <p><GRIN><GRIN></p>;", // 5 and 6
      "export const f = () => <p>smile &#x1F600; now</p>;", // 7 a numeric entity JSX renders as an emoji
      'export const g = () => <span title="&#128512;">x</span>;', // 8 decimal, in an attribute
      'export const h = "flag <FLAG>";', // 9 a regional-indicator pair is one flag
      'export const i = "step <KEYCAP>";', // 10 a keycap sequence
      'export const j = "two <FLAG><FLAG>";', // 11, 12 two flags
      "export const k = 'plain &#x1F600; string, digits 123 # * 1';", // 0 a JS string shows the entity as text; bare digits are not keycaps
      "// <GRIN> in a comment",
    ].join("\n"),
  },
  "components/planted-transition.tsx": {
    counts: { transitionAll: 16 },
    src: [
      'export const a = () => <div className="transition-all duration-200">a</div>;', // 1
      'export const b = () => <div className="hover:transition-all">b</div>;', // 2
      "export const c = `transition: all 0.2s ease`;", // 3
      'export const d = { transition: "all 200ms" };', // 4 inline style object
      "export const e = { transitionProperty: 'all' };", // 5
      "export const h = { transition: 'opacity 1s, all 2s' };", // 6 all after another property
      "export const i = `transition: opacity .2s,all .3s`;", // 7 later, no space after the comma
      "export const j = { transitionProperty: `opacity, all` };", // 8 template value
      "export const k = { transition: `opacity ${d}ms, all ${d}ms` };", // 9 template with substitutions
      'export const p = "flex transition-[all] duration-200";', // 10 arbitrary utility
      'export const q = "transition-[all_.2s]";', // 11
      'export const r = "[transition:all_.2s]";', // 12 arbitrary property
      'el.style.transition = "all .3s";', // 13 an assignment
      'export const s = { ["transition"]: "all 1s" };', // 14 computed key
      'export const t = { WebkitTransition: "all 1s" };', // 15 vendor key
      "export const u = `-webkit-transition: opacity 1s, all 2s`;", // 16 vendor declaration
      'export const f = () => <div className="transition-colors transition-opacity">f</div>;', // near misses: 0
      "export const g = { transition: 'opacity 200ms' };", // 0
      "export const l = { transition: 'opacity 1s, transform 2s' };", // 0
      "export const m = `transition: opacity .2s; will-change: all`;", // 0 the all belongs to the next declaration
      'export const v = "transition-[opacity,transform] transition-[opacity_.2s,transform_.2s] [transition:opacity_1s]";', // 0
      'el.style.transition = "opacity .3s";', // 0
      'el.style.color = "all";', // 0
      'other.transition = "all 1s";', // 0 not a style object
      'export const w = { transitionDelay: "all" };', // 0 not a transition list
      "// transition-all in a comment",
    ].join("\n"),
  },
  "features/planted-duration.tsx": {
    counts: { slowDuration: 5 },
    src: [
      'export const a = () => <div className="duration-500">a</div>;', // 1
      'export const b = () => <div className="duration-[400ms]">b</div>;', // 2
      'export const c = () => <div className="md:duration-700">c</div>;', // 3
      'export const d = () => <div className="duration-[0.5s]">d</div>;', // 4
      'export const e = () => <div className="duration-1000">e</div>;', // 5
      'export const f = () => <div className="duration-300 duration-150 duration-[300ms] duration-[0.3s] duration-[var(--motion-state)]">f</div>;', // 0
    ].join("\n"),
  },
  "components/planted-input.tsx": {
    counts: { smallInput: 14 },
    src: [
      'const fieldCls = "w-full text-[15px]";',
      'const wrapped = fieldCls + " px-2";',
      'export const a = () => <input className="w-full text-sm" />;', // 1
      'export const b = () => <textarea className={cn("w-full", "text-[13px]")} />;', // 2
      'export const c = () => <Input className="h-9 text-xs" />;', // 3 shadcn wrapper
      "export const d = () => <input className={fieldCls} />;", // 4 className held in a same-file const
      "export const e = () => <input className={wrapped} />;", // 5 one hop further
      'export const f = () => <input className={`w-full ${on ? "text-sm" : ""}`} />;', // 6 inside a template
      'export const g = () => <Textarea className="text-[0.75rem]" />;', // 7 rem
      'export const m1 = () => <CommandPrimitive.Input className="w-full font-mono text-[15px]" />;', // 8 a dotted name
      'export const m2 = () => <SearchInput className="text-xs" />;', // 9 a name ending in Input
      'export const m3 = () => <TextArea className="text-sm" />;', // 10
      'export const m4 = () => <input className="text-[0.9em]" />;', // 11 em
      'export const m5 = () => <input className="text-[90%]" />;', // 12 percent
      "export const m6 = () => <input style={{ fontSize: 13 }} />;", // 13 inline style, a number is px
      'export const m7 = () => <input style={{ fontSize: "0.75rem" }} />;', // 14 inline style, a string with a unit
      'export const h = () => <input className="text-base md:text-sm" />;', // 0 base is 16px
      'export const i = () => <input className="md:text-sm" />;', // 0 variant only
      'export const j = () => <input type="checkbox" className="text-sm" />;', // 0 no text caret
      'export const k = () => <input className="text-[16px]" />;', // 0
      'export const l = () => <div className="text-sm" />;', // 0 not an input
      'export const m = () => <button className="text-xs" />;', // 0
      'export const n = () => <input type="text" />;', // 0 no className
      "export const o1 = () => <input style={{ fontSize: 16 }} />;", // 0
      'export const o2 = () => <input style={{ fontSize: "1rem", color: "red" }} />;', // 0
      'export const o3 = () => <InputPrimitive className="text-sm" />;', // 0 the name does not end in Input
      'export const o4 = () => <InputGroup className="text-xs" />;', // 0
      'export const o5 = () => <input className="text-[100%] text-[1em]" />;', // 0
    ].join("\n"),
  },
  "app/styles/planted.css": {
    counts: { transitionAll: 8 },
    src: [
      ".a { transition: all 0.2s; }", // 1
      ".b { transition-property: all; }", // 2
      ".c { @apply transition-all; }", // 3
      ".f { transition: opacity .2s, all .3s; }", // 4 all after another property
      ".g { transition-property: opacity, all; }", // 5
      ".h { transition: opacity .2s,all .3s; }", // 6 no space after the comma
      ".i { transition:\n  opacity .2s,\n  all .3s;\n}", // 7 value spans lines
      ".j { transition: .3s all ease; }", // 8 all is not the first token
      "/* .d { transition: all 1s; } */",
      ".e { transition: opacity 0.2s, transform 0.2s; }",
      ".k { transition: opacity .2s; will-change: all; }", // 0 the all belongs to the next declaration
      ".l { transition-behavior: allow-discrete; }", // 0
      ".m { transition: opacity .2s cubic-bezier(0.4, 0, 0.2, 1), transform .2s; }", // 0
    ].join("\n"),
  },
  "app/styles/planted-uppercase.css": {
    counts: { uppercase: 3 },
    src: [
      ".a { text-transform: uppercase; }", // 1
      ".b{text-transform:uppercase}", // 2
      ".c { @apply uppercase tracking-wide; }", // 3
      ".d { text-transform: none; }",
      ".e { text-transform: capitalize; }",
      "/* .f { text-transform: uppercase; } */",
      ".g { @apply normal-case; }",
    ].join("\n"),
  },
  "app/planted-apply.css": {
    counts: { slowDuration: 2 },
    src: [
      ".a { @apply duration-500 flex; }", // 1
      ".b { @apply transition duration-[700ms]; }", // 2
      ".c { @apply duration-300 duration-150; }", // 0
    ].join("\n"),
  },
  "hooks/planted-hook.ts": {
    counts: { emoji: 1, emDash: 1, uppercase: 1 },
    src: [
      "export const id = <T>(x: T): T => x;", // a generic arrow only parses as TypeScript; read as TSX it opens a JSX element
      'export const label = "hello <GRIN>";', // emoji 1
      'export const dash = "a<D>b";', // emDash 1
      'export const cls = "uppercase";', // uppercase 1: a string, which TSX mode would have swallowed as JSX text
    ].join("\n"),
  },
  "lib/mastery/config.ts": { counts: { emoji: 1 }, src: 'export const icon = "<GRIN>";' },
  "lib/floating-home/smart-now.ts": { counts: { emDash: 1 }, src: 'export const line = "a<D>b";' },
};

const CLEAN: Record<string, string> = {
  "components/clean.tsx": [
    'export const a = () => <p className="font-mono normal-case tracking-wide text-base transition-colors duration-300">clean</p>;',
    'export const b = () => <input className="w-full text-base md:text-sm" />;',
    "export const c = () => <p>done <CHECK> pending <CIRCLE> warn ! removed <TIMES> unknown ?</p>;",
    "export const d = 'a, b: c (d)';",
    "export const e = () => <footer><COPY> 2026 Nick's Tire <REG> <TM></footer>;", // legal marks are not emoji
    "export const f = 'digits 123, hash #, star *, one 1';", // a bare digit is not a keycap
  ].join("\n"),
  "components/comments-only.tsx": [
    "// uppercase <D> <GRIN> transition-all duration-500",
    "/* uppercase <D> <GRIN> transition: all duration-[900ms] */",
    "export const a = () => <p>{/* uppercase <D> <GRIN> transition-all duration-700 */}ok</p>;",
  ].join("\n"),
};

const NOT_SCANNED: Record<string, string> = {
  "lib/not-a-source-root.tsx": 'export const a = () => <p className="uppercase transition-all">x<D>y</p>;',
  "lib/ai/prompt.ts": "export const a = 'x<D>y <GRIN> uppercase';",
  "lib/floating-home/other.ts": "export const a = 'x<D>y <GRIN>';",
  "scripts/tool.ts": "export const a = 'x<D>y <GRIN>';",
  "app/api/route.ts": "export const a = 'x<D>y <GRIN>';",
  "app/api/deep/handler.ts": "export const a = 'x<D>y <GRIN>';",
  "components/types.d.ts": "export type A = 'x<D>y <GRIN>';",
  "components/skipped.test.ts": "export const a = 'x<D>y <GRIN>';",
  "components/skipped.test.tsx": 'export const a = () => <p className="uppercase">x<D>y</p>;',
  "components/skipped.spec.tsx": 'export const a = () => <p className="uppercase">x<D>y</p>;',
  "components/__tests__/skipped.tsx": 'export const a = () => <p className="uppercase">x<D>y</p>;',
  "components/node_modules/pkg/skipped.tsx": 'export const a = () => <p className="uppercase">x<D>y</p>;',
  "components/.hidden/skipped.tsx": 'export const a = () => <p className="uppercase">x<D>y</p>;',
  "app/styles/readme.md": "transition: all",
  "lib/other.css": ".a { transition: all 1s; text-transform: uppercase; }",
};

const plantedFiles = () => Object.fromEntries(Object.entries(PLANTED).map(([rel, p]) => [rel, p.src]));
const withZeros = (counts: Partial<Counts>): Counts => ({ ...zero(), ...counts });

/* --------------------------------- the tests ------------------------------- */

describe("the instrument: every counter sees its planted violation (positive controls)", () => {
  const tree = () => makeTree({ ...plantedFiles(), ...CLEAN, ...NOT_SCANNED });

  it("lists exactly six counters", () => {
    expect([...COUNTERS]).toEqual(["uppercase", "emDash", "emoji", "transitionAll", "slowDuration", "smallInput"]);
  });

  for (const [rel, planted] of Object.entries(PLANTED)) {
    it(`${rel} scores ${JSON.stringify(planted.counts)} and nothing else`, () => {
      const scan = scanTree(tree());
      expect(scan[rel], `${rel} was not visited`).toBeDefined();
      expect(scan[rel]).toEqual(withZeros(planted.counts));
    });
  }

  it("a clean fixture scores 0 on every counter, and so does a file whose only violations sit in comments", () => {
    const scan = scanTree(tree());
    expect(scan["components/clean.tsx"]).toEqual(zero());
    expect(scan["components/comments-only.tsx"]).toEqual(zero());
  });

  it("totals add the planted files up counter by counter, and nothing outside the scan scope leaks in", () => {
    const expected = zero();
    for (const p of Object.values(PLANTED)) for (const k of COUNTERS) expected[k] += p.counts[k] ?? 0;
    expect(sumTotals(scanTree(tree()))).toEqual(expected);
    expect(expected).toEqual({ uppercase: 11, emDash: 16, emoji: 14, transitionAll: 24, slowDuration: 7, smallInput: 14 });
  });
});

describe("scanner edge cases that decide whether a zero can be trusted", () => {
  it("emoji: the sanctioned status glyphs score 0, their pictographic neighbours score", () => {
    expect(scanTsx(`export const a = "${CHECK} ${CIRCLE} ! ${TIMES} ?";`).emoji).toBe(0);
    expect(scanTsx(`export const a = "${HEAVY_CHECK}";`).emoji).toBe(1);
    expect(scanTsx(`export const a = "${String.fromCodePoint(0x2705)}${String.fromCodePoint(0x274c)}";`).emoji).toBe(2);
  });

  it("emoji: the five sanctioned glyphs stay excluded even if the Unicode data called every one a pictograph (drift guard)", () => {
    const everything = () => true;
    expect(countEmoji(`${CHECK}${CIRCLE}!${TIMES}?`, everything)).toBe(0);
    // ...and the guard is only those five: a letter the stub calls a pictograph still scores.
    expect(countEmoji(`${CHECK}a${TIMES}b`, everything)).toBe(2);
  });

  it("emoji: the copyright, registered and trademark signs score 0 each, their pictographic neighbours still score", () => {
    for (const mark of LEGAL_MARKS) expect(countEmoji(mark), `U+${mark.charCodeAt(0).toString(16)} counted`).toBe(0);
    expect(scanTsx(`export const a = () => <footer>${LEGAL_MARKS.join(" ")} 2026</footer>;`).emoji).toBe(0);
    expect(countEmoji(String.fromCodePoint(0x2139))).toBe(1); // information source
    expect(countEmoji(String.fromCodePoint(0x2197))).toBe(1); // north east arrow
  });

  it("emoji: the legal marks stay excluded under the drift guard too, one by one", () => {
    const everything = () => true;
    for (const mark of LEGAL_MARKS) expect(countEmoji(mark, everything)).toBe(0);
  });

  it("emoji: flags, keycaps and numeric entities", () => {
    expect(countEmoji(FLAG)).toBe(1); // a regional-indicator pair
    expect(countEmoji(FLAG + FLAG)).toBe(2);
    expect(countEmoji(String.fromCodePoint(0x1f1ea))).toBe(1); // a lone indicator still renders as a boxed letter
    expect(countEmoji(KEYCAP_ONE)).toBe(1);
    expect(countEmoji(String.fromCodePoint(0x31, KEYCAP))).toBe(1); // no variation selector
    expect(countEmoji("123 # *")).toBe(0);
    expect(decodeEntities("&#x1F600; &#128512; &#x02014; &#08212; &mdash;")).toBe(`${GRIN} ${GRIN} ${EM_DASH} ${EM_DASH} ${EM_DASH}`);
    expect(decodeEntities("&#x110000; &#xZZ;")).toBe("&#x110000; &#xZZ;"); // out of range and malformed are left alone
    // JSX decodes entities in text and attribute strings; a plain JS string shows them as typed.
    expect(scanTsx("export const a = () => <p>&#x1F600;</p>;").emoji).toBe(1);
    expect(scanTsx('export const a = () => <p title="&#128512;">x</p>;').emoji).toBe(1);
    expect(scanTsx("export const a = '&#x1F600; &#x02014;';")).toEqual(zero());
  });

  it("emDash: numeric entities with leading zeros count in JSX text and attributes", () => {
    expect(scanTsx("export const a = () => <p>a &#x02014; b</p>;").emDash).toBe(1);
    expect(scanTsx("export const a = () => <p>a &#08212; b</p>;").emDash).toBe(1);
    expect(scanTsx('export const a = () => <p title="&#x02014;">b</p>;').emDash).toBe(1);
  });

  it("emDash: a unicode escape inside a source string still renders as one, an en dash does not", () => {
    // BACKSLASH + "u2014" is the six-character escape, built here so this file never contains one.
    expect(scanTsx(`export const a = "x${BACKSLASH}u2014y";`).emDash).toBe(1);
    expect(scanTsx(`export const a = "x${EN_DASH}y";`).emDash).toBe(0);
  });

  it("uppercase: token boundaries hold (no match inside a longer class), variants match", () => {
    expect(scanTsx('export const a = "uppercase";').uppercase).toBe(1);
    expect(scanTsx('export const a = "!uppercase group-hover:uppercase [&>span]:uppercase";').uppercase).toBe(3);
    expect(scanTsx('export const a = "uppercased not-uppercase uppercase-x my_uppercase";').uppercase).toBe(0);
  });

  it("uppercase: an unquoted or shorthand object key counts only as an argument of a class helper", () => {
    const n = (src: string) => scanTsx(src).uppercase;
    expect(n('export const a = clsx("x", { uppercase: on });')).toBe(1); // the coordinator's exact input
    expect(n("export const a = clsx('x', { 'uppercase': on });")).toBe(1);
    expect(n("export const a = cn({ uppercase });")).toBe(1);
    expect(n("export const a = classNames({ uppercase: on, bold: b });")).toBe(1);
    expect(n("export const a = styles.cx({ uppercase: on });")).toBe(1);
    expect(n("export const a = foo({ uppercase: on });")).toBe(0);
    expect(n("export const a = cn(foo({ uppercase: on }));")).toBe(0);
    expect(n("export const a = { uppercase: on };")).toBe(0);
  });

  it("slowDuration: 300 is allowed, anything above is not, var() durations are not read", () => {
    const n = (cls: string) => scanTsx(`export const a = "${cls}";`).slowDuration;
    expect(n("duration-300")).toBe(0);
    expect(n("duration-301")).toBe(1);
    expect(n("duration-[300ms]")).toBe(0);
    expect(n("duration-[301ms]")).toBe(1);
    expect(n("duration-[0.31s]")).toBe(1);
    expect(n("duration-[.25s]")).toBe(0);
    expect(n("duration-[var(--motion-state)]")).toBe(0);
  });

  it("smallInput: a className with only a variant size, or a base size of 16px and up, is clean", () => {
    const n = (cls: string, tag = "input") => scanTsx(`export const a = () => <${tag} className="${cls}" />;`).smallInput;
    expect(n("text-sm")).toBe(1);
    expect(n("!text-xs")).toBe(1);
    expect(n("text-sm/6")).toBe(1);
    expect(n("text-[15px]")).toBe(1);
    expect(n("text-[1rem]")).toBe(0);
    expect(n("text-[16px]")).toBe(0);
    expect(n("text-[0.9em]")).toBe(1);
    expect(n("text-[1em]")).toBe(0);
    expect(n("text-[99%]")).toBe(1);
    expect(n("text-[100%]")).toBe(0);
    expect(n("text-base")).toBe(0);
    expect(n("text-lg")).toBe(0);
    expect(n("text-sm", "textarea")).toBe(1);
    expect(n("sm:text-xs max-md:text-sm hover:text-sm")).toBe(0);
  });

  it("smallInput: the tag is matched by suffix, so dotted and prefixed input components are read", () => {
    const n = (tag: string) => scanTsx(`export const a = () => <${tag} className="text-[15px]" />;`).smallInput;
    for (const tag of ["input", "textarea", "Input", "Textarea", "TextArea", "CommandPrimitive.Input", "SearchInput", "Ui.Fields.TextArea"]) {
      expect(n(tag), tag).toBe(1);
    }
    for (const tag of ["InputPrimitive", "InputGroup", "div", "Inputs", "button"]) expect(n(tag), tag).toBe(0);
  });

  it("smallInput: an inline fontSize under 16px counts, a number is px, a string needs a unit", () => {
    const n = (style: string) => scanTsx(`export const a = () => <input style={{ ${style} }} />;`).smallInput;
    expect(n("fontSize: 15")).toBe(1);
    expect(n("fontSize: 16")).toBe(0);
    expect(n('fontSize: "14px"')).toBe(1);
    expect(n('fontSize: "0.9rem"')).toBe(1);
    expect(n('fontSize: "1.1rem"')).toBe(0);
    expect(n('["fontSize"]: 12')).toBe(1);
    expect(n("fontSize: size")).toBe(0);
    expect(n("color: 1")).toBe(0);
  });

  it("smallInput: a cycle of same-file consts terminates", () => {
    const src = 'const a = b + " x"; const b = a + " y"; export const c = () => <input className={a} />;';
    expect(scanTsx(src).smallInput).toBe(0);
  });

  it("transitionAll: `all` anywhere in the list counts, once per declaration", () => {
    const css = (decl: string) => scanCss(`.a { ${decl} }`).transitionAll;
    expect(css("transition: opacity .2s, all .3s;")).toBe(1); // the coordinator's exact input
    expect(css("transition-property: opacity, all;")).toBe(1);
    expect(css("transition: all .2s, all .3s;")).toBe(1); // two all items, one declaration
    expect(css("transition: all .2s; transition-property: all;")).toBe(2);
    expect(css("-webkit-transition: opacity 1s, all 2s;")).toBe(1);
    expect(css("transition: opacity .2s, transform .3s;")).toBe(0);
    expect(css("transition: allow-discrete .2s;")).toBe(0); // a longer word is not `all`
    expect(css("transition-delay: 1s, 2s;")).toBe(0);
    const ts2 = (style: string) => scanTsx(`export const a = () => <div style={{ ${style} }} />;`).transitionAll;
    expect(ts2("transition: 'opacity 1s, all 2s'")).toBe(1); // the coordinator's exact input
    expect(ts2("transition: 'opacity 1s, transform 2s'")).toBe(0);
    expect(ts2("transitionProperty: 'opacity, all'")).toBe(1);
    expect(ts2("transition: someVar")).toBe(0);
    expect(ts2('transition: "all .3s"')).toBe(1); // the control
  });

  it("transitionAll: the arbitrary utility, the arbitrary property, assignments, computed and vendor keys", () => {
    const n = (src: string) => scanTsx(src).transitionAll;
    expect(n('export const a = "transition-[all]";')).toBe(1);
    expect(n('export const a = "transition-[all_.2s]";')).toBe(1);
    expect(n('export const a = "transition-[color,all]";')).toBe(1);
    expect(n('export const a = "transition-[opacity,transform]";')).toBe(0); // 6 legitimate uses in the tree
    expect(n('export const a = "[transition:all]";')).toBe(1); // counted once, not once per regex
    expect(n('export const a = "hover:[transition-property:opacity,all]";')).toBe(1);
    expect(n('el.style.transition = "all .3s";')).toBe(1);
    expect(n('el.style["transition"] = "all .3s";')).toBe(1);
    expect(n("el.style.transition = `opacity ${d}ms, all ${d}ms`;")).toBe(1);
    expect(n('el.style.transition = "opacity .3s";')).toBe(0);
    expect(n('el.transition = "all .3s";')).toBe(0);
    expect(n('export const a = { ["transition"]: "all 1s" };')).toBe(1);
    expect(n('export const a = { WebkitTransition: "all 1s", MozTransition: "all 1s" };')).toBe(2);
  });

  it("css: comments are stripped before the match", () => {
    expect(scanCss("/* transition: all */ .a { color: red }").transitionAll).toBe(0);
    expect(scanCss(".a { transition:all .2s }").transitionAll).toBe(1);
  });

  it("css: text-transform: uppercase and @apply of the counted utilities", () => {
    expect(scanCss(".a { text-transform: uppercase; }").uppercase).toBe(1);
    expect(scanCss(".a { text-transform: none; }").uppercase).toBe(0);
    expect(scanCss("/* text-transform: uppercase */ .a { color: red }").uppercase).toBe(0);
    expect(scanCss(".a { @apply uppercase flex; }").uppercase).toBe(1);
    expect(scanCss(".a { @apply uppercase; text-transform: uppercase; }").uppercase).toBe(2);
    expect(scanCss(".a { @apply duration-500 flex; }").slowDuration).toBe(1);
    expect(scanCss(".a { @apply duration-300; }").slowDuration).toBe(0);
    expect(scanCss(".a { @apply transition-all; }").transitionAll).toBe(1);
  });

  it("scanFile picks the parser by extension: a .ts file parses generics, a .tsx file reads JSX", () => {
    const withGeneric = `export const id = <T>(x: T): T => x;\nexport const s = "${GRIN}";\nexport const c = "uppercase";`;
    expect(scanFile("hooks/a.ts", withGeneric)).toEqual(withZeros({ emoji: 1, uppercase: 1 }));
    expect(scanFile("components/a.tsx", `export const a = () => <p>${GRIN}</p>;`).emoji).toBe(1);
    expect(scanFile("app/a.css", ".a { text-transform: uppercase; }").uppercase).toBe(1);
  });
});

describe("the walker", () => {
  it("visits ts and tsx under components/features/hooks/app (not app/api), css under app, two lib modules, as sorted POSIX paths", () => {
    const dir = makeTree({ ...plantedFiles(), ...CLEAN, ...NOT_SCANNED });
    expect(listSourceFiles(dir)).toEqual([
      "app/planted-apply.css",
      "app/styles/planted-uppercase.css",
      "app/styles/planted.css",
      "components/clean.tsx",
      "components/comments-only.tsx",
      "components/planted-emdash.tsx",
      "components/planted-emoji.tsx",
      "components/planted-input.tsx",
      "components/planted-transition.tsx",
      "components/planted-uppercase.tsx",
      "features/planted-duration.tsx",
      "hooks/planted-hook.ts",
      "lib/floating-home/smart-now.ts",
      "lib/mastery/config.ts",
    ]);
  });

  it("an empty or missing source root yields no files rather than throwing", () => {
    expect(listSourceFiles(makeTree({ "README.md": "x" }))).toEqual([]);
  });

  it("the real tree: the named stable files are visited, so a zero cannot mean 'scanned nothing'", () => {
    const files = listSourceFiles(ROOT);
    const named = [
      "app/(mastery)/missions/page.tsx",
      "components/layout/standard-page.tsx",
      "features/chat-v2/components/chat-island.tsx",
      "hooks/use-slash-commands.ts", // 52 rendered emoji live in a .ts module
      "hooks/use-mention-suggestions.ts",
      "lib/floating-home/smart-now.ts",
      "lib/mastery/config.ts",
      "components/ui/command.tsx", // CommandPrimitive.Input
      "app/globals.css",
      "app/styles/base.css",
    ];
    for (const stable of named) expect(files, `${stable} was not visited`).toContain(stable);
    // 336 .tsx files on 2026-10-15; later waves delete some, so the floors sit well below.
    expect(files.filter((f) => f.endsWith(".tsx")).length).toBeGreaterThan(250);
    expect(files.filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(30);
    expect(files.every((f) => !f.includes("\\") && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.includes("node_modules"))).toBe(true);
    expect(files.filter((f) => f.startsWith("app/api/") || f.startsWith("lib/ai/")), "out-of-scope files leaked in").toEqual([]);
    expect(files.filter((f) => f.startsWith("lib/")).sort()).toEqual([...EXTRA_FILES]);
  });
});

describe("baseline rules", () => {
  const mk = (files: Record<string, Partial<Counts>>): Baseline => {
    const scan: Scan = {};
    for (const [rel, c] of Object.entries(files)) scan[rel] = { ...zero(), ...c };
    return toBaseline(scan);
  };
  const scanOf = (files: Record<string, Partial<Counts>>): Scan => Object.fromEntries(Object.entries(files).map(([rel, c]) => [rel, { ...zero(), ...c }]));

  it("equal to the baseline passes, lower passes", () => {
    const base = mk({ "a.tsx": { uppercase: 3, emoji: 2 } });
    expect(risen(scanOf({ "a.tsx": { uppercase: 3, emoji: 2 } }), base)).toEqual([]);
    expect(risen(scanOf({ "a.tsx": { uppercase: 1 } }), base)).toEqual([]);
    expect(risen(scanOf({}), base)).toEqual([]);
  });

  it("one over in a file fails, and names the file, the counter and both numbers", () => {
    const base = mk({ "a.tsx": { uppercase: 3 } });
    expect(risen(scanOf({ "a.tsx": { uppercase: 4 } }), base)).toEqual(["a.tsx: uppercase 4 > baseline 3", "TOTAL uppercase: 4 > baseline 3"]);
  });

  it("a file the baseline has never seen has baseline 0 for every counter", () => {
    const base = mk({ "a.tsx": { uppercase: 3 } });
    const out = risen(scanOf({ "a.tsx": { uppercase: 3 }, "new.tsx": { smallInput: 1 } }), base);
    expect(out).toContain("new.tsx: smallInput 1 > baseline 0");
    // A counter the file has in the baseline does not lend its allowance to another counter.
    expect(risen(scanOf({ "a.tsx": { uppercase: 3, emDash: 1 } }), base)[0]).toBe("a.tsx: emDash 1 > baseline 0");
  });

  it("an empty or partial baseline object is a baseline of zeros, not a TypeError", () => {
    expect(risen(scanOf({ "a.tsx": { uppercase: 1 } }), {} as unknown as Baseline)).toEqual(["a.tsx: uppercase 1 > baseline 0", "TOTAL uppercase: 1 > baseline 0"]);
    expect(risen(scanOf({ "a.tsx": { uppercase: 1 } }), { totals: zero() } as unknown as Baseline)).toEqual(["a.tsx: uppercase 1 > baseline 0", "TOTAL uppercase: 1 > baseline 0"]);
  });

  it("a total that rises fails even when no single file does (a baseline whose totals were lowered)", () => {
    const tampered: Baseline = { totals: { ...zero(), uppercase: 2 }, files: { "a.tsx": { uppercase: 3 } } };
    expect(risen(scanOf({ "a.tsx": { uppercase: 3 } }), tampered)).toEqual(["TOTAL uppercase: 3 > baseline 2"]);
    const missingTotals = { files: { "a.tsx": { uppercase: 3 } } } as unknown as Baseline;
    expect(risen(scanOf({ "a.tsx": { uppercase: 3 } }), missingTotals)).toEqual(["TOTAL uppercase: 3 > baseline 0"]);
  });

  it("baselineProblems: a well-formed baseline is clean; a hand-raised file number, a bad key or a bad value is named", () => {
    expect(baselineProblems(mk({ "a.tsx": { uppercase: 3 }, "b.tsx": { emoji: 1 } }))).toEqual([]);
    const raised: Baseline = { totals: { ...zero(), uppercase: 3 }, files: { "a.tsx": { uppercase: 9 } } };
    expect(baselineProblems(raised)).toEqual(["totals.uppercase is 3 but the files sum to 9"]);
    expect(baselineProblems({ totals: zero(), files: { "a\\b.tsx": { uppercase: 1 } } }).join("|")).toContain("not a POSIX path");
    expect(baselineProblems({ totals: zero(), files: { "a.tsx": { nope: 1 } as unknown as Partial<Counts> } }).join("|")).toContain("unknown counter nope");
    expect(baselineProblems({ totals: zero(), files: { "a.tsx": { uppercase: 0 } } }).join("|")).toContain("must be a positive integer");
    expect(baselineProblems({ totals: zero(), files: { "a.tsx": { uppercase: 1.5 } } }).join("|")).toContain("must be a positive integer");
  });

  it("a stale key passes baselineProblems (that is why staleKeys exists) and is named by staleKeys", () => {
    // The coordinator's case: a key for a file that is gone, with the totals raised to match.
    const stale: Baseline = { totals: { ...zero(), uppercase: 8 }, files: { "components/a.tsx": { uppercase: 3 }, "components/does-not-exist-anymore.tsx": { uppercase: 5 } } };
    expect(baselineProblems(stale)).toEqual([]);
    expect(staleKeys(stale, ["components/a.tsx"])).toEqual(["components/does-not-exist-anymore.tsx"]);
    expect(staleKeys(stale, ["components/a.tsx", "components/does-not-exist-anymore.tsx"])).toEqual([]);
    expect(staleKeys({} as unknown as Baseline, ["a.tsx"])).toEqual([]);
  });

  it("toBaseline keeps only non-zero entries, sorted, with totals that match", () => {
    const b = toBaseline(scanOf({ "z.tsx": { uppercase: 1 }, "a.tsx": { emoji: 2, uppercase: 1 }, "m.tsx": {} }));
    expect(Object.keys(b.files)).toEqual(["a.tsx", "z.tsx"]);
    expect(b.totals).toEqual({ ...zero(), uppercase: 2, emoji: 2 });
  });

  it("planUpdate: lowering is allowed, raising is reported, a first baseline has nothing to raise from", () => {
    const prev = mk({ "a.tsx": { uppercase: 3 } });
    expect(planUpdate(prev, scanOf({ "a.tsx": { uppercase: 1 } })).raised).toEqual([]);
    expect(planUpdate(prev, scanOf({ "a.tsx": { uppercase: 4 } })).raised.length).toBeGreaterThan(0);
    expect(planUpdate(prev, scanOf({ "a.tsx": { uppercase: 3 }, "b.tsx": { emDash: 1 } })).raised.length).toBeGreaterThan(0);
    expect(planUpdate(null, scanOf({ "a.tsx": { uppercase: 40 } })).raised).toEqual([]);
  });

  it("updateMode: 1 is lower, init is init, anything else is no update", () => {
    expect(updateMode("1")).toBe("lower");
    expect(updateMode("init")).toBe("init");
    for (const v of [undefined, "", "0", "true", "INIT", "2"]) expect(updateMode(v), String(v)).toBeNull();
  });

  it("UPDATE_RATCHET=1 refuses a MISSING baseline: it throws and creates nothing", () => {
    const dir = makeTree({});
    const path = join(dir, "baseline.json");
    expect(() => applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 } }))).toThrow(/refuses to create a baseline/);
    expect(() => applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 } }), "lower")).toThrow(/refuses to create a baseline/);
    expect(existsSync(path)).toBe(false);
  });

  it("UPDATE_RATCHET=init creates the baseline and may raise an existing one (widening the scan, once)", () => {
    const dir = makeTree({});
    const path = join(dir, "baseline.json");
    const first = applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 } }), "init");
    expect(first.totals).toEqual({ ...zero(), uppercase: 3 });
    const raised = applyUpdate(path, scanOf({ "a.tsx": { uppercase: 9 }, "b.tsx": { emoji: 4 } }), "init");
    expect(raised.totals).toEqual({ ...zero(), uppercase: 9, emoji: 4 });
    expect(baselineProblems(JSON.parse(readFileSync(path, "utf8")) as Baseline)).toEqual([]);
  });

  it("UPDATE_RATCHET=1 refuses to raise a number: it throws and leaves the file byte for byte as it was", () => {
    const dir = makeTree({});
    const path = join(dir, "baseline.json");
    applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 } }), "init"); // first write
    const before = readFileSync(path, "utf8");
    expect(() => applyUpdate(path, scanOf({ "a.tsx": { uppercase: 4 } }))).toThrow(/refuses to raise/);
    expect(() => applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 }, "b.tsx": { emoji: 1 } }))).toThrow(/b\.tsx: emoji 1 > baseline 0/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("UPDATE_RATCHET=1 lowers: counts that fell are written, a deleted file drops out, the file stays well formed", () => {
    const dir = makeTree({});
    const path = join(dir, "baseline.json");
    applyUpdate(path, scanOf({ "a.tsx": { uppercase: 3 }, "gone.tsx": { emoji: 2 } }), "init");
    const next = applyUpdate(path, scanOf({ "a.tsx": { uppercase: 1 } }));
    expect(next.files).toEqual({ "a.tsx": { uppercase: 1 } });
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Baseline & { _about: string };
    expect(onDisk.files).toEqual({ "a.tsx": { uppercase: 1 } });
    expect(onDisk.totals).toEqual({ ...zero(), uppercase: 1 });
    expect(baselineProblems(onDisk)).toEqual([]);
    expect(onDisk._about).toContain("never rise");
  });
});

/* ------------------------------- the real tree ----------------------------- */

let realScan: Scan | null = null;
const scanReal = () => (realScan ??= scanTree(ROOT));

function readBaseline(): Baseline {
  expect(existsSync(BASELINE_PATH), "ui-v3-ratchets.baseline.json is missing: restore it from git (UPDATE_RATCHET=1 refuses to create it)").toBe(true);
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const MODE = updateMode(process.env.UPDATE_RATCHET);

describe("UI v3 ratchets on the real tree", () => {
  it.runIf(MODE !== null)(
    "UPDATE_RATCHET: rewrite the baseline from the tree (mode 1 refuses any number that would rise or a missing file)",
    () => {
      const written = applyUpdate(BASELINE_PATH, scanReal(), MODE!);
      expect(baselineProblems(written)).toEqual([]);
    },
    120_000,
  );

  it("the baseline file is well formed, its totals match its files, and every key is a file the scan visits", () => {
    const baseline = readBaseline();
    expect(baselineProblems(baseline)).toEqual([]);
    const stale = staleKeys(baseline, listSourceFiles(ROOT));
    expect(stale, `stale baseline keys (deleted, moved or renamed; re-key by hand or run UPDATE_RATCHET=1):\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("no file goes above its baseline, no unlisted file has a violation, no total rises", () => {
    const over = risen(scanReal(), readBaseline());
    expect(over, `UI grammar regressed (fix it; lower the baseline only with UPDATE_RATCHET=1):\n  ${over.join("\n  ")}`).toEqual([]);
  }, 120_000);
});
