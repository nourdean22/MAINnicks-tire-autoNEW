/**
 * mobileErgonomics.test.ts · 2026-08-03
 *
 * Source-level guards for the phone-only defect class that no existing test could
 * see. Both apps run as standalone PWAs on the operator's iPhone and on customer
 * phones, and the defects here are invisible to unit tests (nothing throws),
 * invisible to typecheck (the classes are valid), and invisible to lint (the code
 * is well-formed). They are only visible as a thumb missing a button.
 *
 * WHY SOURCE TEXT AND NOT SCREENSHOTS: visual-regression was investigated and is
 * blocked — nickstire cannot boot hermetically (the server hard-exits without a
 * real DB) and admin routes have no test-auth bypass. Reading source is the
 * pattern this repo already uses for exactly this reason; see
 * server/deadEndClosure.test.ts.
 *
 * SCOPE DISCIPLINE: every guard below is either a NARROW rule measured to have
 * zero violations in the current tree, or a pin on a specific fix in the
 * deadEndClosure style. A guard that needs suppressions is not shipped. In
 * particular there is deliberately NO general "all buttons are 48px" rule — icon
 * buttons inside a larger padded row are legitimately small, and a rule that
 * flagged them would be turned off within a week.
 *
 * `window.confirm/alert/prompt` is deliberately NOT guarded here: scripts/lint-source.mjs
 * already fails hard on it ("client dialog globals — hard"), and duplicating a
 * live gate is churn.
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Every .tsx under client/src, so a new component cannot dodge the sweep. */
function allClientTsx(dir = "client/src"): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(resolve(process.cwd(), rel))) {
      const relPath = join(rel, entry);
      const abs = resolve(process.cwd(), relPath);
      if (statSync(abs).isDirectory()) walk(relPath);
      else if (entry.endsWith(".tsx")) out.push(relPath);
    }
  };
  walk(dir);
  return out;
}

/**
 * A full-viewport `backdrop-filter` is the single most expensive thing a phone
 * renders, and on an `lg:hidden` element it renders ONLY on phones — the weakest
 * device pays a cost the desktop never does.
 *
 * Two real instances existed when this guard was written, both behind a scrim
 * opaque enough that the blur was near-invisible: the admin sidebar scrim
 * (bg-black/60 + backdrop-blur-sm) and the public mobile nav
 * (oklch(…/0.98) + backdrop-blur-2xl, the heaviest tier in the tree, shipped to
 * every customer opening the menu).
 *
 * Narrow on purpose: it fires only when `fixed inset-0`, a backdrop-blur AND
 * `lg:hidden` appear on the same element. Desktop-visible modal scrims are
 * untouched, which is why this passes at zero violations rather than forty.
 */
describe("no full-viewport backdrop blur on phone-only overlays", () => {
  const offenders: Array<{ file: string; line: number; text: string }> = [];
  const scanned = allClientTsx();
  let linesScanned = 0;

  for (const file of scanned) {
    const lines = read(file).split("\n");
    linesScanned += lines.length;
    lines.forEach((text, i) => {
      // Comments explaining WHY the blur was removed must not count as violations.
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "");
      if (
        stripped.includes("fixed inset-0") &&
        stripped.includes("backdrop-blur") &&
        stripped.includes("lg:hidden")
      ) {
        offenders.push({ file, line: i + 1, text: text.trim().slice(0, 120) });
      }
    });
  }

  /**
   * The guard on the guard. `expect([]).toEqual([])` is also what an empty sweep
   * returns, so a broken walker, a moved directory or a renamed extension would
   * turn this suite green while scanning nothing — a fresh instance of exactly the
   * all-clear-on-failure class this file exists to prevent. Floors measured on
   * 2026-08-03: 142 files, ~38k lines.
   */
  it("actually scanned the client tree", () => {
    expect(scanned.length).toBeGreaterThan(100);
    expect(linesScanned).toBeGreaterThan(20_000);
  });

  it("has no phone-only full-screen scrim carrying a backdrop-blur", () => {
    expect(offenders.map((o) => `${o.file}:${o.line} — ${o.text}`)).toEqual([]);
  });
});

/**
 * Pins, deadEndClosure-style — each locks one fix that review or measurement
 * caught, so it cannot silently regress.
 */
describe("admin shell uses the dynamic viewport, not the large one", () => {
  const shell = read("client/src/pages/Admin.tsx");

  it("the shell root is min-h-dvh", () => {
    expect(shell).toMatch(/admin-shell min-h-dvh/);
    expect(shell).not.toMatch(/admin-shell min-h-screen/);
  });

  /**
   * The load-bearing one. The aside is `fixed h-screen` on mobile with a
   * `flex-1 overflow-y-auto` nav above a `shrink-0` footer, so when 100vh exceeds
   * the visible viewport the overflow lands exactly on the footer and the
   * "Back to site" link renders under the browser toolbar, untappable.
   */
  it("the sidebar is h-dvh", () => {
    expect(shell).toMatch(/admin-sidebar fixed lg:sticky[^"`]*h-dvh/);
    expect(shell).not.toMatch(/admin-sidebar fixed lg:sticky[^"`]*h-screen/);
  });
});

describe("phone-reachable controls meet the 48px touch minimum", () => {
  /**
   * apps/nickstire/AGENTS.md, "iOS PWA": Minimum 48x48px touch targets. Both
   * controls below shipped on a phone-first surface; the first shipped at ~24px
   * and was caught in review, not by a test. These pin the corrected sizes.
   */
  it("the bad-link notice dismiss button is at least 48px", () => {
    const s = read("client/src/components/admin/UnknownSectionNotice.tsx");
    // w-12/h-12 is 48px in this Tailwind scale, and is the house pattern.
    expect(s).toMatch(/w-12 h-12/);
    expect(s).toMatch(/aria-label="Dismiss bad-link notice"/);
  });

  /**
   * Found by an adversarial sweep AFTER the review catch, and both were worse than
   * the control review flagged: insight.tsx was a bare button with no padding at
   * all around a 16px glyph (a 16x16px target, the smallest in the admin), and
   * AdminAlertBar was p-1 around a 14px glyph (22x22px). Same widget kind —
   * dismissable notice — same one-handed-phone surface.
   */
  it("the shared insight-card dismiss is at least 48px", () => {
    const s = read("client/src/pages/admin/shared/insight.tsx");
    expect(s).toMatch(/w-12 h-12[^"]*aria-label="Dismiss"|aria-label="Dismiss"/);
    expect(s).toMatch(/w-12 h-12/);
  });

  it("the admin alert bar dismiss is at least 48px", () => {
    const s = read("client/src/components/admin/AdminAlertBar.tsx");
    expect(s).toMatch(/w-12 h-12/);
    expect(s).not.toMatch(/className=\{`p-1 rounded hover:bg-black\/10/);
  });

  it("the mobile quick-actions trigger is at least 48px and phone-only", () => {
    const s = read("client/src/components/admin/CommandSearch.tsx");
    expect(s).toMatch(/aria-label="Quick actions"/);
    // w-14 h-14 = 56px, comfortably over the minimum.
    expect(s).toMatch(/lg:hidden fixed[^"`]*w-14 h-14/);
  });

  /**
   * The FAB and the SSE pulse stack both occupy bottom-right. The pulse container
   * is pointer-events-none but its pills are pointer-events-auto, up to three at
   * once for 6s each — so without the mobile offset an SSE burst would cover the
   * button and swallow taps aimed at it, on the busiest screen in the admin.
   */
  it("ActivityPulse clears the quick-actions button on mobile", () => {
    const s = read("client/src/components/admin/ActivityPulse.tsx");
    expect(s).toMatch(/lg:bottom-\[calc\(1rem\+env\(safe-area-inset-bottom,0\)\)\]/);
    // The mobile inset must be strictly larger than the desktop 1rem one.
    const mobile = s.match(/bottom-\[calc\((\d+(?:\.\d+)?)rem\+env\(safe-area-inset-bottom,0\)\)\]\s+lg:bottom/);
    expect(mobile).not.toBeNull();
    expect(Number(mobile![1])).toBeGreaterThan(1);
  });
});
