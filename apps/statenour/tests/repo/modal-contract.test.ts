/**
 * Modal runtime contract · 2026-10-01.
 *
 * Most overlays must use components/ui/dialog.tsx (Base UI) so focus trap,
 * focus restoration, Escape/outside dismissal and scroll lock are inherited
 * instead of reimplemented. Three specialized surfaces intentionally remain
 * manual: Inspector sheet (shared with non-modal desktop panel + ViewTransition),
 * MegaConfirm, and BreakPromise (both already carry explicit focus loops).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = ["components", "app", "features"].map((name) => join(ROOT, name));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ALLOWED_MANUAL = new Set([
  "components/actions/break-promise-modal.tsx",
  "components/inspector/inspector-frame.tsx",
  "components/operator/mega-confirm-dialog.tsx",
]);

describe("modal runtime contract", () => {
  it("does not allow new hand-rolled aria-modal surfaces", () => {
    const manual = SCAN_ROOTS.flatMap(walk)
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes('aria-modal="true"'))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
      .sort();

    expect(manual).toEqual([...ALLOWED_MANUAL].sort());
  });

  it("manual exceptions retain explicit focus containment", () => {
    for (const rel of ALLOWED_MANUAL) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source, `${rel} lost focusable enumeration`).toContain("querySelectorAll<HTMLElement>");
    }

    const inspector = readFileSync(join(ROOT, "components/inspector/inspector-frame.tsx"), "utf8");
    expect(inspector).toContain('document.body.style.overflow = "hidden"');
    expect(inspector).toContain("previousFocus.focus");

    const mega = readFileSync(join(ROOT, "components/operator/mega-confirm-dialog.tsx"), "utf8");
    expect(mega).toContain("previousFocusRef");
    expect(mega).toContain('document.body.style.overflow = "hidden"');

    const promise = readFileSync(join(ROOT, "components/actions/break-promise-modal.tsx"), "utf8");
    expect(promise).toContain("previouslyFocused");
    expect(promise).toContain('document.body.style.overflow = "hidden"');
  });

  it("manual confirmation actions keep a 44px phone floor", () => {
    const mega = readFileSync(join(ROOT, "components/operator/mega-confirm-dialog.tsx"), "utf8");
    expect(mega.match(/min-h-\[44px\]/g)?.length).toBeGreaterThanOrEqual(2);

    const promise = readFileSync(join(ROOT, "components/actions/break-promise-modal.tsx"), "utf8");
    expect(promise).toContain("h-11 w-11");
    expect(promise.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(promise).toContain('text-[16px]');
  });
});
