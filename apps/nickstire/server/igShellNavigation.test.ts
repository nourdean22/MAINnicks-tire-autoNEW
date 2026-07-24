/**
 * Five-view shell navigation pins (Wave 4, 2026-07-24).
 *
 * The old shell held its nine tabs in local React state: every refresh or PWA
 * relaunch silently reset the operator to HQ, and no screen was linkable.
 * These pin the URL-backed vocabulary + the legacy-key mapping that keeps old
 * deep links (hq/studio/queue/inbox/learn/drafts) working.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IG_PRIMARY_VIEWS, IG_SECONDARY_VIEWS, normalizeIgView } from "../client/src/pages/admin/instagram/igViews";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("view vocabulary", () => {
  it("exactly five primary views, in operator-job order", () => {
    expect(IG_PRIMARY_VIEWS.map((v) => v.key)).toEqual(["today", "create", "publish", "community", "insights"]);
  });

  it("rare surfaces live behind the gear, not in the primary row", () => {
    expect(IG_SECONDARY_VIEWS.map((v) => v.key)).toEqual(["planning", "actions", "control", "settings"]);
  });
});

describe("normalizeIgView", () => {
  it.each([
    ["hq", "today"],
    ["studio", "create"],
    ["queue", "publish"],
    ["inbox", "community"],
    ["learn", "insights"],
    ["drafts", "planning"],
  ])("maps legacy tab key %s → %s (old deep links keep working)", (legacy, expected) => {
    expect(normalizeIgView(legacy)).toBe(expected);
  });

  it("passes through every current view key", () => {
    for (const { key } of [...IG_PRIMARY_VIEWS, ...IG_SECONDARY_VIEWS]) {
      expect(normalizeIgView(key)).toBe(key);
    }
  });

  it("falls back to today for null/garbage — never a crash, never a blank shell", () => {
    expect(normalizeIgView(null)).toBe("today");
    expect(normalizeIgView("not-a-view")).toBe("today");
  });
});

describe("the shell persists the active view in the URL", () => {
  it("initial view reads from the URL and navigation writes back", () => {
    const shell = read("client/src/pages/admin/instagram/InstagramAdmin.tsx");
    expect(shell).toMatch(/useState<IgView>\(\(\) => readIgViewFromUrl\(\)\)/);
    expect(shell).toMatch(/writeIgViewToUrl\(view\)/);
  });

  it("replaceState preserves the admin's other query params (?tab= routing)", () => {
    const views = read("client/src/pages/admin/instagram/igViews.ts");
    expect(views).toMatch(/searchParams\.set\("igview", view\)/);
    expect(views).toMatch(/replaceState/);
  });
});
