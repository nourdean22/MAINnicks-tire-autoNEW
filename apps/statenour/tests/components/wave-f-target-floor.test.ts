/**
 * bdnick wave F (2026-10-25): /brain and /people joined tests/e2e/target-size.spec.ts, so every control those
 * pages (and Photo Improver, under the house rules) can mount carries the 44 px floor in its own tag.
 *
 * The e2e spec measures the element box, so the floor must sit on the measured element: the button, the field,
 * the select, the summary, the link styled as a box, a FreshnessChip with a reload action. Most of these only
 * render with data (the local e2e database is dead, CI's is empty), so this pins the source; CI's e2e run stays
 * the instrument for the box. Shared primitives (components/ui/*, page tabs, the Nick side pane) are out of
 * scope here: their call sites carry the floor.
 *
 * Rules, as in tests/components/settings/target-floor.test.ts round 4 and 5: a height floor on every measured
 * tag, a width floor on every button (a short label under px-2 measured 40 wide). Exempt: a textarea of two or
 * more rows, a rem min height, a plain inline text link, a hidden input. New here: inside one class list a
 * later, smaller min-h-[Npx] overrides min-h-11 (cn merges to the last), so that pair fails too; and a
 * className held in a same-file const is read.
 *
 * Positive control: planted small controls fail, and the sweep must locate its subjects (a scanner that
 * matched nothing would pass on a deleted control).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

const FILES = [
  "app/(mastery)/people/page.tsx",
  "app/(mastery)/photo-improver/page.tsx",
  "components/relationships/todays-picks.tsx",
  "components/relationships/relationships-watchlist.tsx",
  "components/relationships/person-edit-drawer.tsx",
  "components/power-atlas/DossierEditor.tsx",
  "components/power-atlas/LedgerTimeline.tsx",
  "components/power-atlas/PowerBalanceGauge.tsx",
  "components/power-atlas/BlowUpModal.tsx",
  "components/power-atlas/LogLedgerModal.tsx",
  "components/power-atlas/ArcProjection.tsx",
  "components/power-atlas/PowerPlaysModal.tsx",
  "components/power-atlas/PowerPlaysHistory.tsx",
  "components/power-atlas/PersonInsights.tsx",
  "components/brain/knowledge-review-tab.tsx",
  "components/brain/qualitative-identity-panel.tsx",
  "components/brain/beliefs-panel.tsx",
  "components/brain/contradiction-resolution-panel.tsx",
  "components/brain/nudge-panel.tsx",
  "components/brain/brain-maturity-header.tsx",
  "components/brain/pinned-context-panel.tsx",
  "components/brain/insight-ribbon.tsx",
  "components/brain/brain-insights-panel.tsx",
  "components/brain/recall-preview-panel.tsx",
  "components/brain/pattern-card.tsx",
  "components/brain/anti-patterns-panel.tsx",
  "components/brain/health-view.tsx",
  "components/brain/continuity-view.tsx",
  "components/brain/tool-telemetry-panel.tsx",
  "components/brain/suggestion-telemetry-panel.tsx",
  "components/brain/knowledge-action-outcomes.tsx",
  "components/brain/wisdom-tab.tsx",
  "components/brain/receipts-timeline.tsx",
  "components/brain/related-wisdom-links.tsx",
  "components/brain/wisdom-evolution-panel.tsx",
  "components/ultron/decision-replay-card.tsx",
  "components/ultron/persona-drift-card.tsx",
];

const NAMES = ["button", "Button", "input", "Input", "select", "textarea", "Textarea", "Link", "a", "FreshnessChip", "summary"];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Opening JSX tags of NAMES (skips `>` inside {...} and strings). */
function openingTags(src: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(${NAMES.join("|")})(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let q: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === q && src[i - 1] !== "\\") q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

const WIDTH_FLOOR = /(?<![\w:-])(min-w-11|w-11|w-12|w-14|w-16|w-full|flex-1|size-11|size-12|min-w-\[(?:4[4-9]|[5-9]\d)px\]|px-(?:4|5|6|8))(?![\w-])/;
const HEIGHT_FLOOR = /(?<![\w:-])(min-h-11|h-11|h-12|h-14|min-h-12|size-11|size-12|min-h-\[(?:4[4-9]|[5-9]\d|\d{3})px\]|h-\[(?:4[4-9]|[5-9]\d)px\])(?![\w-])/;
/** min-h-11 followed, in the same tag, by a smaller unprefixed min-h-[Npx]: the later class wins in cn(). */
const OVERRIDDEN = /(?<![\w:-])min-h-11(?![\w-])[\s\S]*(?<![\w:-])min-h-\[(?:[1-3]\d|4[0-3]|\d)px\]/;

/** `className={inputCls}` reads the same-file `const inputCls = "..."`. */
function withConsts(tag: string, src: string): string {
  return tag.replace(/className=\{(\w+)\}/, (whole, name: string) => {
    const m = new RegExp(`const ${name}\\s*=\\s*\\n?\\s*["'\`]([^"'\`]*)["'\`]`).exec(src);
    return m ? `className="${m[1]}"` : whole;
  });
}

function measured(src: string): string[] {
  const bare = stripComments(src);
  return openingTags(bare)
    .map((t) => withConsts(t, bare))
    .filter((t) => {
      if (/^<input\b/.test(t) && /type="hidden"/.test(t)) return false;
      if (/^<(a|Link)\b/.test(t)) return /href=/.test(t) && /(?<![\w-])(inline-flex|flex|block|inline-block)(?![\w-])/.test(t);
      if (/^<FreshnessChip\b/.test(t)) return /onReload=/.test(t);
      if (/^<textarea\b/i.test(t) && /rows=\{?["']?([2-9]|\d\d)/.test(t)) return false;
      if (/min-h-\[\d+(?:\.\d+)?(?:rem|em)\]/.test(t)) return false;
      return true;
    });
}

function unfloored(src: string): string[] {
  return measured(src)
    .filter((t) => !HEIGHT_FLOOR.test(t) || OVERRIDDEN.test(t) || (/^<(button|Button)\b/.test(t) && !WIDTH_FLOOR.test(t)))
    .map((t) => t.replace(/\s+/g, " ").slice(0, 120));
}

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("wave F: every control /brain, /people and Photo Improver can mount carries the 44 px floor in its own tag", () => {
  it("no measured control in the swept files is under the floor", () => {
    const bad = FILES.flatMap((f) => unfloored(read(f)).map((t) => `${f}: ${t}`));
    expect(bad).toEqual([]);
  });

  it("the sweep located its subjects in every file (a scanner that sees nothing passes on anything)", () => {
    const seen = FILES.map((f) => [f, measured(read(f)).length] as const);
    expect(seen.filter(([, n]) => n === 0), "a file with no measured control: moved, renamed or blind").toEqual([]);
    expect(seen.reduce((a, [, n]) => a + n, 0)).toBeGreaterThan(130);
    expect(measured(read("components/brain/pinned-context-panel.tsx")).length).toBeGreaterThanOrEqual(12);
    expect(measured(read("app/(mastery)/people/page.tsx")).length).toBeGreaterThanOrEqual(12);
  });

  it("positive control: planted small controls fail; the exempt forms pass", () => {
    expect(unfloored(`<button type="button" className="px-1.5 py-0.5">x</button>`)).toHaveLength(1);
    expect(unfloored(`<Button variant="outline" size="sm" onClick={go}>+ deposit</Button>`)).toHaveLength(1);
    expect(unfloored(`<button type="button" className="min-h-[44px] px-2">no</button>`)).toHaveLength(1); // tall, too narrow
    expect(unfloored(`<input className="h-8 w-full" />`)).toHaveLength(1);
    expect(unfloored(`<FreshnessChip lastFetchedAt={t} onReload={reload} />`)).toHaveLength(1);
    expect(unfloored(`<summary className="px-3 py-2.5">more</summary>`)).toHaveLength(1);
    // the defect this wave hit: a later min-h-[36px] beats min-h-11 inside cn()
    expect(unfloored(`<button className={cn("min-h-11 min-w-11 inline-flex min-h-[36px] px-3")}>Pin</button>`)).toHaveLength(1);
    // a className held in a const is read, both ways
    expect(unfloored(`const inputCls = "w-full h-8";\n<input className={inputCls} />`)).toHaveLength(1);
    expect(unfloored(`const inputCls = "w-full min-h-[44px]";\n<input className={inputCls} />`)).toHaveLength(0);
    // exempt: a two-row textarea, a rem min height, an inline text link, a chip with no reload, a breakpoint-only size
    expect(unfloored(`<textarea rows={3} className="w-full" />`)).toHaveLength(0);
    expect(unfloored(`<Textarea className="min-h-[16rem]" />`)).toHaveLength(0);
    expect(unfloored(`<a href="/x" className="underline">source</a>`)).toHaveLength(0);
    expect(unfloored(`<FreshnessChip lastFetchedAt={t} />`)).toHaveLength(0);
    expect(unfloored(`<button className="sm:min-h-11 sm:min-w-11">x</button>`)).toHaveLength(1);
    // and a comment that names the class does not satisfy it
    expect(unfloored(`{/* className="min-h-11 min-w-11" */}<button className="px-1">x</button>`)).toHaveLength(1);
  });
});
