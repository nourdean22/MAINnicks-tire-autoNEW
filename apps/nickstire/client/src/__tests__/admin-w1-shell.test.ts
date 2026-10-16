/**
 * Admin UI v1 Wave 1 shell contract (PLAN.md section 3, W1): graphite is the admin default with no
 * attribute or toggle, the decoration the cockpit genome forbids is gone, the topbar targets are 44 px,
 * and the phone bar keeps the last row reachable. Source shape, by design: jsdom applies no stylesheet,
 * so the CSS rules and the shell's class tokens are the thing to pin. CSS comments are stripped first
 * so a note about a deleted rule cannot satisfy or fail an assertion.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "client/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const admin = readFileSync(join(ROOT, "client/src/pages/Admin.tsx"), "utf8");
const cards = readFileSync(join(ROOT, "client/src/pages/admin/shared/cards.tsx"), "utf8");

/** The declaration block of the first rule whose selector list matches. */
function ruleBody(selector: RegExp): string | null {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (selector.test(m[1].trim())) return m[2];
  return null;
}

describe("graphite is the admin default", () => {
  it("the neutral tokens apply to .admin-shell itself, with no attribute gate left", () => {
    expect(css).not.toContain("data-admin-theme");
    // body:has(.admin-shell) carries the tokens to portals (Radix popovers, dialogs, the sonner
    // Toaster) that render outside the shell while the admin is mounted.
    const body = ruleBody(/^\.admin-shell\s*,\s*\.admin-shell \.admin-sidebar\s*,\s*body:has\(\.admin-shell\)$/);
    expect(body, "a `.admin-shell, .admin-shell .admin-sidebar, body:has(.admin-shell)` token block").not.toBeNull();
    expect(body).toMatch(/--background:\s*#0B0C0E/i);
    expect(body).toMatch(/--card:\s*#15171A/i);
    expect(body).toMatch(/--primary:\s*#FAFAFA/i);
    expect(body).toMatch(/--owner-priority:\s*#FDB913/i);
  });

  it("the public :root keeps its own tokens (the customer site is untouched)", () => {
    const root = ruleBody(/^:root$/);
    expect(root).not.toBeNull();
    // Values as of 2026-10-16: the gold-and-black public site.
    for (const [token, value] of [["--background", "#0A0A0A"], ["--foreground", "#F5F5F5"], ["--card", "#141414"], ["--primary", "#FDB913"], ["--border", "#2A2A2A"]]) {
      expect(root, token).toMatch(new RegExp(`${token}:\\s*${value};`, "i"));
    }
  });

  it("the admin topbar no longer mounts the theme toggle (one admin theme, nothing to toggle)", () => {
    expect(admin).not.toMatch(/<ThemeToggle\b/);
  });
});

describe("decoration the cockpit genome forbids is gone", () => {
  it("no scan-line overlay on the shell", () => {
    expect(css).not.toMatch(/\.admin-shell::?after\s*[,{]/);
  });
  it("no revenue glow and no transition: all on stat values", () => {
    expect(css).not.toMatch(/\.revenue-glow\s*\{/);
    expect(css).not.toMatch(/\.number-animate\s*\{/);
    expect(cards).not.toMatch(/revenue-glow|number-animate|CountUpNumber/);
  });
  it("no backdrop-blur class token anywhere in the shell markup", () => {
    // Comments stripped first: the scrim's comment explains why it has no blur.
    const code = admin.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/(^|[\s"`:])backdrop-blur(-[\w[\]./]+)?(?=[\s"`]|$)/m);
  });
  it("no backdrop blur on the admin topbar", () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.admin-topbar/.test(m[1])) expect(m[2], m[1].trim()).not.toMatch(/backdrop-filter/);
    }
  });
});

describe("48 px targets in the shell", () => {
  it("the topbar search trigger and density toggle are 48 px too (they live in their own files)", () => {
    const search = readFileSync(join(ROOT, "client/src/components/admin/CommandSearch.tsx"), "utf8");
    const density = readFileSync(join(ROOT, "client/src/components/admin/DensityToggle.tsx"), "utf8");
    // The trigger's className follows its aria-label inside the same <button>.
    const trigger = sliceBlock(search, 'aria-label="Search"', "</button>", { label: "CommandSearch.tsx" });
    expect(trigger).toMatch(/\bh-12 min-w-12\b/);
    expect(density).toMatch(/\bw-12 h-12\b/);
  });
  it("the hamburger and every topbar action are w-12 h-12 (48 px, the repo floor)", () => {
    const header = sliceBlock(admin, "<header", "</header>", { label: "Admin.tsx" });
    expect(header).toMatch(/aria-label="Open sidebar"/);
    const sized = header.match(/w-12 h-12/g) ?? [];
    // hamburger + the topbar action links (one template literal renders all of them)
    expect(sized.length).toBeGreaterThanOrEqual(2);
    expect(header).not.toMatch(/\bw-9 h-9\b/);
  });
  it("the sidebar close button and every sidebar item are min-h-12", () => {
    expect(admin).toMatch(/aria-label="Close sidebar"/);
    const close = /className="([^"]*)" aria-label="Close sidebar"/.exec(admin);
    expect(close, "the close button's own className").not.toBeNull();
    expect(close![1]).toMatch(/\bmin-h-12\b/);
    expect(admin).toMatch(/admin-sidebar-item w-full min-h-12/);
  });
});

describe("the phone bar keeps the last row reachable", () => {
  it("Admin.tsx renders the bar and .admin-content pads for it below lg", () => {
    expect(admin).toMatch(/<AdminTabBar\b/);
    const phone = css.match(/@media \(max-width: 1023px\)\s*\{\s*\.admin-shell \.admin-content\s*\{([^}]*)\}/);
    expect(phone, "a max-width 1023px .admin-content rule").not.toBeNull();
    expect(phone![1]).toMatch(/padding-bottom:\s*calc\(56px[^;]*env\(safe-area-inset-bottom/);
  });
});

describe("48 px targets on Today and the section boundary", () => {
  const overview = readFileSync(join(ROOT, "client/src/pages/admin/OverviewSection.tsx"), "utf8");
  const boundary = readFileSync(join(ROOT, "client/src/components/admin/AdminSectionBoundary.tsx"), "utf8");
  it("queue filter chips, queue verbs and the call/message links are min-h-12", () => {
    // W2 moved the row verbs and the call/message links into today/QueueRow.tsx, so both files are scanned.
    const queue =
      sliceBlock(overview, 'aria-label="Filter queue"', 'aria-labelledby="history-title"', { label: "OverviewSection.tsx" }) +
      readFileSync(join(ROOT, "client/src/pages/admin/today/QueueRow.tsx"), "utf8");
    // Each control's own className (the first one after its opening tag); arrow functions in onClick
    // contain ">", so a [^>]* tag scan would stop early.
    const controls = [...queue.matchAll(/<(?:button|a|MessageCustomerLink)\b/g)].map((m) => {
      const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(queue.slice(m.index!));
      return cls ? cls[1] ?? cls[2] : "";
    });
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const c of controls) expect(c).toMatch(/min-h-12/);
  });
  it("the section boundary Retry is min-h-12", () => {
    const retry = sliceBlock(boundary, "onClick={this.handleRetry}", "Retry section", { label: "AdminSectionBoundary.tsx" });
    expect(retry).toMatch(/min-h-12/);
  });
});

describe("the phone bar never hides or out-ranks what sits around it", () => {
  const bar = readFileSync(join(ROOT, "client/src/components/admin/AdminTabBar.tsx"), "utf8");
  const z = (src: string) => Number(/(?:^|\s)z-(\d+)(?:\s|$)/.exec(src)?.[1] ?? NaN);
  it("the bar sits below the drawer scrim, so the open drawer covers it", () => {
    const scrim = sliceBlock(admin, "{sidebarOpen && <div", "/>", { label: "Admin.tsx" });
    const barClass = /aria-label="Primary sections"\s*className="([^"]*)"/.exec(bar)?.[1] ?? "";
    expect(z(barClass)).toBeLessThan(z(scrim));
  });
  it("the drawer itself sits above the bar", () => {
    const aside = /<aside className=\{`admin-sidebar ([^`]*)`\}/.exec(admin)?.[1] ?? "";
    const barClass = /aria-label="Primary sections"\s*className="([^"]*)"/.exec(bar)?.[1] ?? "";
    expect(z(aside)).toBeGreaterThan(z(barClass));
  });
  it("the walk-in totals box sticks above the bar on phones and to the bottom on desktop", () => {
    const walkIn = readFileSync(join(ROOT, "client/src/pages/admin/WalkInCalculatorSection.tsx"), "utf8");
    const sticky = /className="sticky ([^"]*)"/.exec(walkIn)?.[1] ?? "";
    expect(sticky).toMatch(/(^|\s)bottom-\[calc\(56px\+env\(safe-area-inset-bottom,0px\)\)\](\s|$)/);
    expect(sticky).toMatch(/(^|\s)lg:bottom-0(\s|$)/);
  });
  it("Admin.tsx forces the dark class while it is mounted (ThemeToggle is gone)", () => {
    // Anchored to a code line: `// useAdminDarkClass();` must not count.
    expect(admin).toMatch(/^\s*useAdminDarkClass\(\);\s*$/m);
  });
  it("the bar gets the signed-in role, the live section, the real signals and the palette opener", () => {
    const tag = sliceBlock(admin, "<AdminTabBar", "/>", { label: "Admin.tsx" });
    expect(tag).toMatch(/\brole=\{adminRole\}/);
    expect(tag).toMatch(/\bactive=\{section\}/);
    expect(tag).toMatch(/\bsignals=\{signals\}/);
    expect(tag).toMatch(/\bonSearch=\{openCommandSearch\}/);
    expect(tag).toMatch(/\bonNavigate=\{\(nextSection\) => allowedSections\.includes\(nextSection\) && setSection\(nextSection\)\}/);
  });
});

describe("gold marks owner priority only", () => {
  const overview = readFileSync(join(ROOT, "client/src/pages/admin/OverviewSection.tsx"), "utf8");
  it("Today's Needs action card turns gold only when the queue is readable and holds items", () => {
    const card = sliceBlock(overview, 'label="Needs action"', "/>", { label: "OverviewSection.tsx" });
    expect(card).toMatch(/priority=\{queueTrustworthy && queue\.length > 0\}/);
    expect(overview).toMatch(/priority \? "[^"]*var\(--owner-priority\)/);
  });
});
