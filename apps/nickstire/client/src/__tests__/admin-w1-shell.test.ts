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
    const body = ruleBody(/^\.admin-shell\s*,\s*\.admin-shell \.admin-sidebar$/);
    expect(body, "a `.admin-shell, .admin-shell .admin-sidebar` token block").not.toBeNull();
    expect(body).toMatch(/--background:\s*#0B0C0E/i);
    expect(body).toMatch(/--card:\s*#15171A/i);
    expect(body).toMatch(/--primary:\s*#FAFAFA/i);
    expect(body).toMatch(/--owner-priority:\s*#FDB913/i);
  });

  it("the public :root keeps its own primary (the customer site is untouched)", () => {
    const root = ruleBody(/^:root$/);
    expect(root).not.toBeNull();
    expect(root).not.toMatch(/--primary:\s*#FAFAFA/i);
  });

  it("the admin topbar no longer mounts the theme toggle (one admin theme, nothing to toggle)", () => {
    expect(admin).not.toMatch(/<ThemeToggle\b/);
  });
});

describe("decoration the cockpit genome forbids is gone", () => {
  it("no scan-line overlay on the shell", () => {
    expect(css).not.toMatch(/\.admin-shell::after\s*\{/);
  });
  it("no revenue glow and no transition: all on stat values", () => {
    expect(css).not.toMatch(/\.revenue-glow\s*\{/);
    expect(css).not.toMatch(/\.number-animate\s*\{/);
    expect(cards).not.toMatch(/revenue-glow|number-animate|CountUpNumber/);
  });
  it("no backdrop blur on the admin topbar", () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.admin-topbar/.test(m[1])) expect(m[2], m[1].trim()).not.toMatch(/backdrop-filter/);
    }
  });
});

describe("44 px targets in the shell", () => {
  it("the hamburger and every topbar action are h-11 w-11", () => {
    const header = admin.slice(admin.indexOf("<header"), admin.indexOf("</header>"));
    expect(header).toMatch(/aria-label="Open sidebar"/);
    const sized = header.match(/w-11 h-11/g) ?? [];
    // hamburger + the topbar action links (one template literal renders all of them)
    expect(sized.length).toBeGreaterThanOrEqual(2);
    expect(header).not.toMatch(/\bw-9 h-9\b/);
  });
  it("the sidebar close button and every sidebar item are min-h-11", () => {
    expect(admin).toMatch(/aria-label="Close sidebar"/);
    const close = admin.slice(admin.lastIndexOf("<button", admin.indexOf('aria-label="Close sidebar"')), admin.indexOf('aria-label="Close sidebar"'));
    expect(close).toMatch(/min-h-11/);
    expect(admin).toMatch(/admin-sidebar-item w-full min-h-11/);
  });
});

describe("the phone bar keeps the last row reachable", () => {
  it("Admin.tsx renders the bar and .admin-content pads for it below lg", () => {
    expect(admin).toMatch(/<AdminTabBar\b/);
    const phone = css.match(/@media \(max-width: 1023px\)\s*\{\s*\.admin-content\s*\{([^}]*)\}/);
    expect(phone, "a max-width 1023px .admin-content rule").not.toBeNull();
    expect(phone![1]).toMatch(/padding-bottom:\s*calc\(56px[^;]*env\(safe-area-inset-bottom/);
  });
});

describe("gold marks owner priority only", () => {
  const overview = readFileSync(join(ROOT, "client/src/pages/admin/OverviewSection.tsx"), "utf8");
  it("Today's Needs action card turns gold only when the queue is readable and holds items", () => {
    const at = overview.indexOf('label="Needs action"');
    const card = overview.slice(at, overview.indexOf("/>", at));
    expect(card).toMatch(/priority=\{queueTrustworthy && queue\.length > 0\}/);
    expect(overview).toMatch(/priority \? "[^"]*var\(--owner-priority\)/);
  });
});
