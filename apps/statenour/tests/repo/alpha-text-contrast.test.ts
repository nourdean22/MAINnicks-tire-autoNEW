/**
 * Faded text ratchet (audit 09-X7): no `text-<colour>/<alpha>` below WCAG AA 4.5:1.
 *
 * An alpha modifier on a text colour is the quiet way readable text becomes unreadable: the token passes
 * every check by name (text-red-300 is 7:1) and the /50 halves it. This scans every class string under
 * app/, components/, features/, hooks/ and lib/ (class maps live in lib too), composites each faded text
 * token over the three surfaces text sits on (canvas, surface, surface-interactive) and fails on the
 * worst one under 4.5:1. Not scanned: CSS @apply (none use a faded text token today) and classes built
 * by interpolation (`text-${tone}/60`), which no static scan can resolve.
 *
 * Exempt, by WCAG: an element with aria-hidden or disabled, a separator glyph (its only child is
 * punctuation), a lucide icon (non-text, 3:1, not this gate), and state variants (hover:, focus:,
 * placeholder:, disabled:, group-*:, ...), which are not the text at rest. A colour this test cannot
 * resolve (rgba, color-mix) is reported as unresolved: unknown never passes.
 * shortcut: reads the class, not the cascade. A parent `opacity-*` or a tinted card background is not
 * composited; read the rendered style if a site needs that precision.
 *
 * Do NOT fix a site here by editing tokens.css or input/textarea borders: operator design sign-off (OP-22).
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blend, paletteHex, ratio, resolveColor, tokenHex } from "../helpers/contrast";

const ROOT = join(__dirname, "..", "..");
const AA = 4.5;
const SURFACES = ["canvas", "surface", "surface-interactive"].map((n) => tokenHex(n));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(name) ? [p] : [];
  });
}
const FILES = ["app", "components", "features", "hooks", "lib"].flatMap((d) => walk(join(ROOT, d))).map((f) => relative(ROOT, f).replaceAll("\\", "/"));

/**
 * `text-<name>`, `text-[var(--x)]`, `text-(--x)` or `text-[#hex]`, then `/<alpha>` as `/60`, `/[0.6]` or
 * `/[60%]`, with any variant chain in front. Groups: 1 variants, 2 name, 3 var, 4 paren var, 5 hex, 6 alpha.
 */
const FADED = /(?<![\w\-[(])((?:[\w-]+:)*)text-((?:[a-z]+(?:-[a-z]+)*(?:-\d{2,3})?)|\[var\((--[\w-]+)\)\]|\((--[\w-]+)\)|\[(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\])\/(\d{1,3}|\[[\d.]+%?\])(?![\w/])/g;
/** `60` -> 60, `[0.6]` -> 60, `[60%]` -> 60. */
const alphaPct = (raw: string) => (raw.startsWith("[") ? (raw.endsWith("%]") ? parseFloat(raw.slice(1)) : parseFloat(raw.slice(1)) * 100) : Number(raw));
const RESPONSIVE = /^(?:sm|md|lg|xl|2xl|max-[\w-]+|min-[\w-]+|dark|print|motion-safe|motion-reduce):$/;
const FONT_SIZE = /^(?:xs|sm|base|lg|[2-9]?xl)$/;
const SEPARATOR = /^[\s\u00b7\u2022|/\-\u2013\u2014:,]+$/;

/** Worst contrast of one faded token over the three surfaces, or null when its colour does not resolve. */
export function worstRatio(name: string, alpha: number): number | null {
  const hex = name.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  const fg = hex
    ? `#${hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex}`.toUpperCase()
    : resolveColor(name.startsWith("--") ? name : `--color-${name}`);
  if (!fg) return null;
  return Math.min(...SURFACES.map((bg) => ratio(blend(fg, alpha / 100, bg), bg)));
}

/** The JSX element a class string belongs to, if it sits in one of that element's attributes. */
function ownerElement(node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isJsxAttributes(n)) return n.parent as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isSourceFile(n)) return null;
  }
  return null;
}

/** The literal is one branch of a `?:`, `&&` or `||` inside the attribute (a class chosen by state). */
function conditional(literal: ts.Node): boolean {
  for (let n: ts.Node | undefined = literal.parent; n && !ts.isJsxAttribute(n); n = n.parent) {
    if (ts.isConditionalExpression(n)) return true;
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) return true;
  }
  return false;
}

function exempt(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, lucide: Set<string>, literal: ts.Node): boolean {
  const attrs = el.attributes.properties.filter(ts.isJsxAttribute);
  // An always-on flag exempts. A state flag (`disabled={!canMove}`) exempts only a class picked by state:
  // a static faded class on that element is faded while it is enabled too.
  // shortcut: assumes the class condition and the flag condition agree; compare the two expressions if that bites.
  const has = (name: string) =>
    attrs.some(
      (a) =>
        a.name.getText() === name &&
        (!a.initializer || /^\{\s*true\s*\}$|^"true"$/.test(a.initializer.getText()) || (!/false/.test(a.initializer.getText()) && conditional(literal))),
    );
  if (has("aria-hidden") || has("disabled")) return true;
  if (lucide.has(el.tagName.getText())) return true;
  if (ts.isJsxOpeningElement(el)) {
    const kids = (el.parent as ts.JsxElement).children;
    const text = kids.map((k) => (ts.isJsxText(k) ? k.text : ts.isJsxExpression(k) && k.expression && ts.isStringLiteral(k.expression) ? k.expression.text : "\u0000")).join("");
    if (kids.length > 0 && SEPARATOR.test(text)) return true;
  }
  return false;
}

/** Every faded text token under 4.5:1 in one source file, as "<file> -> <token>" (unresolved colours marked). */
export function fadedText(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lucide = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && (st.moduleSpecifier as ts.StringLiteral).text === "lucide-react") {
      const named = st.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const el of named.elements) lucide.add(el.name.text);
    }
  }
  const out: string[] = [];
  (function visit(n: ts.Node): void {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      for (const m of n.text.matchAll(FADED)) {
        const variants = m[1].match(/[\w-]+:/g) ?? [];
        if (!variants.every((v) => RESPONSIVE.test(v))) continue;
        const name = m[3] ?? m[4] ?? m[5] ?? m[2];
        if (FONT_SIZE.test(name)) continue;
        const owner = ownerElement(n);
        if (owner && exempt(owner, lucide, n)) continue;
        const worst = worstRatio(name, alphaPct(m[6]));
        const token = m[0];
        if (worst === null) out.push(`${file} -> ${token} (unresolved)`);
        else if (worst < AA) out.push(`${file} -> ${token}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

const count = (list: string[]) => list.reduce((acc, k) => acc.set(k, (acc.get(k) ?? 0) + 1), new Map<string, number>());
let scanned: Map<string, number> | null = null;
/** One walk of the tree, shared by the scan and its reverse canary. */
const scanTree = () => (scanned ??= count(FILES.flatMap((f) => fadedText(f, readFileSync(join(ROOT, f), "utf8")))));

/**
 * KNOWN, dated 2026-10-11 (R3-06): every faded text token under 4.5:1 in the tree that day, with how many
 * times the file uses it. The ratchet only turns one way: a new site fails the scan; a fixed site fails
 * the reverse canary until its count here is lowered or its line deleted.
 * Re-checked after R3-07 landed (same day): error-boundary.tsx's /50 is gone; its text-rose-300/80 is not
 * listed because it clears 4.5:1 (4.55 on surface-interactive, a thin margin). R3-07's other files hold none.
 */
const KNOWN_FADED: Record<string, number> = {
  "app/(mastery)/decisions/[id]/page.tsx -> text-rose-300/70": 1,
  "app/(mastery)/people/page.tsx -> text-rose-300/70": 1,
  "app/(mastery)/system/actions/page.tsx -> text-rose-400/70": 1,
  "app/(mastery)/system/inbox/page.tsx -> text-amber-400/80": 1,
  "components/actions/loop-row-item.tsx -> text-amber-400/80": 1,
  "components/actions/loop-row-item.tsx -> text-amber-500/50": 1,
  "components/actions/loop-row-item.tsx -> text-rose-400/70": 1,
  "components/actions/loop-row-item.tsx -> text-violet-400/50": 1,
  "components/actions/loop-row-item.tsx -> text-violet-400/60": 1,
  "components/actions/loop-row-item.tsx -> text-violet-400/70": 1,
  "components/actions/loop-stream.tsx -> text-violet-400/60": 1,
  "components/actions/milestones-flow.tsx -> text-blue-400/70": 1,
  "components/actions/mode-learn.tsx -> text-amber-400/60": 1,
  "components/actions/mode-learn.tsx -> text-amber-400/70": 1,
  "components/actions/mode-learn.tsx -> text-amber-400/80": 1,
  "components/actions/mode-learn.tsx -> text-blue-400/50": 1,
  "components/actions/mode-learn.tsx -> text-blue-400/70": 1,
  "components/actions/mode-learn.tsx -> text-cyan-400/50": 1,
  "components/actions/mode-learn.tsx -> text-cyan-400/60": 1,
  "components/actions/mode-learn.tsx -> text-cyan-500/50": 1,
  "components/actions/mode-learn.tsx -> text-emerald-400/80": 1,
  "components/actions/mode-learn.tsx -> text-violet-400/50": 1,
  "components/actions/mode-learn.tsx -> text-violet-400/70": 3,
  "components/actions/mode-learn.tsx -> text-violet-400/80": 1,
  "components/actions/task-filters.tsx -> text-fg-tertiary/60": 1,
  "components/brain-dump-modal.tsx -> text-[var(--gold)]/50": 1,
  "components/brain/brain-maturity-header.tsx -> text-rose-300/70": 1,
  "components/brain/continuity-view.tsx -> text-rose-300/70": 1,
  "components/brain/health-view.tsx -> text-[var(--text-tertiary)]/60": 1,
  "components/brain/health-view.tsx -> text-amber-400/80": 1,
  "components/brain/health-view.tsx -> text-rose-300/70": 1,
  "components/brain/insight-ribbon.tsx -> text-[var(--text-tertiary)]/70": 1,
  "components/brain/judgment-quality-panel.tsx -> text-amber-400/80": 2,
  "components/brain/memory-tab.tsx -> text-[var(--text-tertiary)]/60": 2,
  "components/brain/memory-tab.tsx -> text-emerald-400/70": 1,
  "components/brain/memory-tab.tsx -> text-red-400/90": 1,
  "components/brain/memory-tab.tsx -> text-rose-400/70": 1,
  "components/brain/pinned-context-panel.tsx -> text-[var(--text-tertiary)]/60": 1,
  "components/brain/pinned-context-panel.tsx -> text-emerald-400/70": 1,
  "components/brain/qualitative-identity-panel.tsx -> text-red-300/70": 1,
  "components/brain/recall-inbox-panel.tsx -> text-[var(--text-tertiary)]/60": 1,
  "components/brain/recall-inbox-panel.tsx -> text-[var(--text-tertiary)]/70": 1,
  "components/brain/receipts-timeline.tsx -> text-rose-400/90": 1,
  "components/brain/research-pipeline-status.tsx -> text-amber-400/80": 2,
  "components/brain/suggestion-telemetry-panel.tsx -> text-amber-400/80": 1,
  "components/brain/suggestion-telemetry-panel.tsx -> text-emerald-400/70": 1,
  "components/brain/suggestion-telemetry-panel.tsx -> text-red-400/80": 1,
  "components/brain/tool-telemetry-panel.tsx -> text-red-300/70": 1,
  "components/brain/tool-telemetry-panel.tsx -> text-red-400/60": 1,
  "components/brain/tool-telemetry-panel.tsx -> text-red-400/90": 1,
  "components/chat/nick-message.tsx -> text-[var(--text-tertiary)]/60": 1,
  "components/chat/slash-command-dropdown.tsx -> text-blue-400/70": 1,
  "components/chat/wisdom-pill.tsx -> text-[var(--text-tertiary)]/60": 1,
  "components/goals/goal-board.tsx -> text-amber-400/50": 1,
  "components/goals/goal-board.tsx -> text-amber-400/60": 1,
  "components/goals/goal-board.tsx -> text-amber-400/70": 2,
  "components/goals/goal-board.tsx -> text-emerald-400/70": 2,
  "components/goals/goal-board.tsx -> text-sky-400/70": 1,
  "components/goals/goal-board.tsx -> text-violet-400/80": 1,
  "components/home/horizon-line.tsx -> text-fg-tertiary/80": 1,
  "components/journal/entry-row.tsx -> text-amber-400/60": 2,
  "components/journal/entry-row.tsx -> text-emerald-400/50": 1,
  "components/journal/entry-row.tsx -> text-emerald-400/80": 1,
  "components/journal/journal-insights-preview.tsx -> text-amber-400/80": 2,
  "components/journal/journal-insights-preview.tsx -> text-emerald-400/80": 1,
  "components/journal/journal-insights-preview.tsx -> text-fg-tertiary/60": 1,
  "components/mastery/identity-arc-card.tsx -> text-white/30": 1,
  "components/mastery/identity-arc-card.tsx -> text-white/40": 1,
  "components/power-atlas/LedgerTimeline.tsx -> text-rose-300/60": 1,
  "components/power-atlas/PowerPlaysModal.tsx -> text-amber-300/70": 1,
  "components/settings/ai-settings-panel.tsx -> text-red-300/60": 1,
  "components/stats/journey-panel.tsx -> text-fg-secondary/60": 1,
  "components/ultron/bottom-pulse-ticker.tsx -> text-emerald-400/80": 1,
  "components/ultron/contradictions-card.tsx -> text-emerald-400/80": 1,
  "components/ultron/observability/cost-slo-tile.tsx -> text-rose-300/70": 1,
  "components/ultron/persona-drift-card.tsx -> text-amber-400/80": 1,
  "components/ultron/preferences-card.tsx -> text-amber-400/80": 1,
  "components/ultron/preferences-card.tsx -> text-emerald-400/80": 1,
  "components/ultron/signal/situation-card.tsx -> text-emerald-400/60": 1,
};

describe("09-X7: faded text stays readable (4.5:1 over every dark surface)", () => {
  it("POSITIVE CONTROL: the oklch converter reproduces the hex tokens.css records", () => {
    for (const n of ["red-300", "amber-300", "rose-400", "sky-400"]) expect(resolveColor(`--color-${n}`)).toBe(paletteHex(n).toUpperCase());
    expect(resolveColor("--color-fg-tertiary")).toBe(tokenHex("text-tertiary").toUpperCase());
    expect(resolveColor("--color-white")).toBe("#FFFFFF");
  });

  it("POSITIVE CONTROL: a planted text-red-300/60 fails; text-red-300 and exempt sites pass", () => {
    expect(fadedText("x.tsx", '<p className="text-[11px] text-red-300/60">domain</p>')).toEqual(["x.tsx -> text-red-300/60"]);
    expect(fadedText("x.tsx", '<p className="text-[11px] text-red-300">domain</p>')).toEqual([]);
    expect(fadedText("x.ts", 'const TONE = { muted: "text-fg-tertiary/30" };')).toEqual(["x.ts -> text-fg-tertiary/30"]);
    expect(fadedText("x.tsx", '<span className="md:text-[var(--text-tertiary)]/40">a</span>')).toEqual(["x.tsx -> md:text-[var(--text-tertiary)]/40"]);
    // Every alpha and colour spelling Tailwind v4 accepts (guard-red-team probes, 2026-10-11).
    expect(fadedText("x.tsx", '<p className="text-red-300/[0.5]">a</p>')).toEqual(["x.tsx -> text-red-300/[0.5]"]);
    expect(fadedText("x.tsx", '<p className="text-red-300/[50%]">a</p>')).toEqual(["x.tsx -> text-red-300/[50%]"]);
    expect(fadedText("x.tsx", '<p className="text-[#8E887C]/60">a</p>')).toEqual(["x.tsx -> text-[#8E887C]/60"]);
    expect(fadedText("x.tsx", '<p className="text-(--text-tertiary)/60">a</p>')).toEqual(["x.tsx -> text-(--text-tertiary)/60"]);
    expect(fadedText("x.tsx", '<p className="!text-red-300/50 text-red-300/50!">a</p>')).toEqual(["x.tsx -> text-red-300/50", "x.tsx -> text-red-300/50"]);
    expect(fadedText("x.tsx", '<p className="text-[#7bb3ff]/90">a</p>')).toEqual([]);
    // Exempt: decorative, inactive, separator, icon, state variant, font-size shorthand, a comment.
    expect(fadedText("x.tsx", '<span aria-hidden className="text-fg-tertiary/30">o</span>')).toEqual([]);
    expect(fadedText("x.tsx", '<button disabled className="text-fg-tertiary/30">Save</button>')).toEqual([]);
    expect(fadedText("x.tsx", '<button disabled={busy} className="text-fg-tertiary/30">Save</button>')).toEqual(["x.tsx -> text-fg-tertiary/30"]);
    expect(fadedText("x.tsx", '<span aria-hidden={!open} className="text-fg-tertiary/30">Menu</span>')).toEqual(["x.tsx -> text-fg-tertiary/30"]);
    expect(fadedText("x.tsx", '<button disabled={!can} className={cn("p-2", can ? "text-fg" : "text-fg-tertiary/30")}>Up</button>')).toEqual([]);
    expect(fadedText("x.tsx", '<button disabled={false} className={cn(can ? "text-fg" : "text-fg-tertiary/30")}>Up</button>')).toEqual(["x.tsx -> text-fg-tertiary/30"]);
    expect(fadedText("x.tsx", '<span className="text-fg-tertiary/30">{"\u00b7"}</span>')).toEqual([]);
    expect(fadedText("x.tsx", 'import { X } from "lucide-react";\nconst a = <X className="text-fg-tertiary/30" />;')).toEqual([]);
    expect(fadedText("x.tsx", '<input className="placeholder:text-fg-tertiary/30 hover:text-fg/40" />')).toEqual([]);
    expect(fadedText("x.tsx", '<p className="text-sm/6">a</p>')).toEqual([]);
    expect(fadedText("x.tsx", "// text-red-300/60 was here\nconst a = 1;")).toEqual([]);
    // A colour this test cannot resolve is reported, never passed.
    expect(fadedText("x.tsx", '<p className="text-[var(--no-such-token)]/90">a</p>')).toEqual(["x.tsx -> text-[var(--no-such-token)]/90 (unresolved)"]);
  });

  it("the scan reads the whole UI tree", () => {
    expect(FILES.length).toBeGreaterThan(700);
  });

  it("no faded text token under 4.5:1 beyond the dated KNOWN list", () => {
    const now = scanTree();
    const over = [...now].filter(([k, n]) => n > (KNOWN_FADED[k] ?? 0)).map(([k, n]) => `${k} x${n}`);
    expect(over, `faded text under ${AA}:1 (fix it, do not list it):\n  ${over.join("\n  ")}`).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN entry still has that many sites (lower the count once one is fixed)", () => {
    const now = scanTree();
    const fixed = Object.entries(KNOWN_FADED).filter(([k, n]) => (now.get(k) ?? 0) < n).map(([k, n]) => `${k}: known ${n}, now ${now.get(k) ?? 0}`);
    expect(fixed, `fixed, so lower or delete in KNOWN_FADED:\n  ${fixed.join("\n  ")}`).toEqual([]);
  });
});
