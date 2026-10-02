import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("responsive navigation shell contract", () => {
  it("uses one primary navigation region at XL while preserving the signal ticker", () => {
    const bottom = source("components/layout/bottom-tab-bar.tsx");
    const spine = source("components/layout/desktop-spine.tsx");

    expect(bottom).toContain("ui-material flex items-stretch border-t border-edge-subtle xl:hidden");
    expect(spine).toContain("hidden w-[var(--spine-w,4.5rem)] flex-col");
    expect(spine).toContain("xl:flex");
    expect(bottom.indexOf("<BottomPulseTicker />")).toBeLessThan(bottom.indexOf("<nav"));
  });

  it("keeps Chat drawer controls at a 44px phone touch floor", () => {
    const drawer = source("features/chat-v2/components/operator-conversation-drawer.tsx");

    expect(drawer).toContain('onClick={onNew} className="flex min-h-11');
    expect(drawer).toContain('onClick={onClose} aria-label="Close history" className="flex h-11 w-11');
    expect(drawer).toContain('onClick={onShowActions} className="flex min-h-11');
    expect(drawer).toContain('placeholder="Search conversations" className="h-11');
    expect(drawer).toContain('className={`min-h-11 rounded-md sm:min-h-8');
    expect(drawer).toContain('className="mt-2 min-h-11 w-full');
  });

  it("keeps MoreSheet explicit, reachable, and phone-safe", () => {
    const more = source("components/layout/more-sheet.tsx");

    expect(more).toContain('aria-label="Close More menu"');
    expect(more).toContain('className="absolute right-0 inline-flex h-11 w-11');
    expect(more).toContain('className="flex min-h-11 w-full items-center gap-2 rounded-control');
    expect(more).toContain('"flex min-h-11 items-center gap-2 rounded-lg');
    expect(more).toContain('className="inline-flex min-h-11 max-w-[140px]');
    expect(more).toContain('"flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2');
    expect(more).toContain('"flex min-h-11 flex-1 items-center justify-center');
  });

  it("keeps classic PageTabs at the same 44px phone floor as lensed tabs", () => {
    const tabs = source("components/layout/page-tabs.tsx");
    expect(tabs).toContain('"min-h-11 shrink-0 px-3 py-2 text-[13px] font-medium');
    expect(tabs).toContain('const SUB_ITEM =\n  "inline-flex min-h-[44px]');
  });

  it("never advertises a G-chord without a routed destination", () => {
    const shortcuts = source("components/hud/keyboard-shortcuts.tsx");
    const listed = [...shortcuts.matchAll(/keys: \["G", "([A-Z])"\]/g)]
      .map((match) => match[1].toLowerCase());
    const routeBlock = shortcuts.slice(
      shortcuts.indexOf("const GO_ROUTES"),
      shortcuts.indexOf("export function KeyboardShortcuts"),
    );
    const routed = new Set(
      [...routeBlock.matchAll(/^\s*([a-z]):\s*"\//gm)].map((match) => match[1]),
    );

    expect(listed.filter((key) => !routed.has(key))).toEqual([]);
    expect(shortcuts).not.toContain("Go to Financial");
    expect(shortcuts).not.toContain("Go to /system/quality");
    expect(shortcuts).not.toContain("Go to /system/power");
  });
});
