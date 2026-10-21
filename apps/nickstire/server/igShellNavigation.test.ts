/**
 * Five-view shell navigation pins (Wave 4, 2026-07-24).
 *
 * The old shell held its nine tabs in local React state: every refresh or PWA
 * relaunch silently reset the operator to HQ, and no screen was linkable.
 * These pin the URL-backed vocabulary + the legacy-key mapping that keeps old
 * deep links working. W3 (2026-10-19) cut Community, Planning board and Pattern Lab and merged
 * Pipeline health + Autonomy control into Controls; the full redirect table is pinned in
 * client/src/__tests__/ig-views-redirects.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IG_PRIMARY_VIEWS, IG_SECONDARY_VIEWS, normalizeIgView } from "../client/src/pages/admin/instagram/igViews";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("view vocabulary", () => {
  it("exactly four primary views, in operator-job order", () => {
    expect(IG_PRIMARY_VIEWS.map((v) => v.key)).toEqual(["today", "create", "publish", "insights"]);
  });

  it("rare surfaces live behind the gear, not in the primary row", () => {
    // "controls" is FIRST on purpose (W3, 2026-10-19): every stop switch for the autonomous lanes
    // (kill switches, send lanes, image autopost, comment responder) plus the read-only pipeline
    // health sits behind one door, so "pause it" and "is it ok" are one screen.
    // "strategy" joined 2026-09-27 on purpose: it is the operator surface for
    // active-slate ordering, creative-fatigue evidence, profile merchandising,
    // and judge/outcome calibration. It stays secondary so the daily jobs
    // remain the primary navigation contract.
    expect(IG_SECONDARY_VIEWS.map((v) => v.key)).toEqual(["controls", "strategy", "actions", "settings"]);
  });
});

describe("normalizeIgView", () => {
  it.each([
    ["hq", "today"],
    ["studio", "create"],
    ["queue", "publish"],
    ["inbox", "today"],
    ["learn", "insights"],
    ["drafts", "create"],
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

describe("cross-view handoffs carry real context (Wave 5)", () => {
  it("Insights' Build-a-sequel hands over the winning post's identity and metrics", () => {
    const learn = read("client/src/pages/admin/instagram/Learn.tsx");
    expect(learn).toMatch(/writeCreateHandoff\(\{/);
    expect(learn).toMatch(/sourceType: "proven_post"/);
    expect(learn).toMatch(/recordId: winner\.postId/);
  });

  it("Create consumes the handoff exactly once on mount", () => {
    const studio = read("client/src/pages/admin/instagram/StudioV2.tsx");
    expect(studio).toMatch(/consumeCreateHandoff\(\)/);
  });

  it("legacy Studio offers ONLY the reel format (client-invented static quality is unreachable)", () => {
    const legacy = read("client/src/pages/admin/instagram/Studio.tsx");
    expect(legacy).toMatch(/\.filter\(\(key\) => key === "reel"\)/);
  });

  it("QueueV2 keeps autosaved drafts out of the review lanes", () => {
    expect(read("client/src/pages/admin/instagram/QueueV2.tsx")).toMatch(/item\.status === "draft"\) return false/);
  });
});

describe("Insights honesty (Wave 7)", () => {
  it("Insights headline stats are account-wide (getAccountAverages), with the top-5 stat labeled as top-5", () => {
    const learn = read("client/src/pages/admin/instagram/Learn.tsx");
    expect(learn).toMatch(/accountAverages/);
    expect(learn).toMatch(/top 5/);
    const analytics = read("server/routers/instagramAdmin.ts");
    expect(analytics).toMatch(/getAccountAverages\(\)/);
  });

  it("every Insights stat block states its source, window, and sample basis", () => {
    expect(read("client/src/pages/admin/instagram/Learn.tsx")).toMatch(/Source: Meta analytics cache/);
  });
});

describe("legacy surface cleanup (Wave 8)", () => {
  it("the orphaned IgAutopostPanel is gone", () => {
    expect(() => read("client/src/pages/admin/settings/IgAutopostPanel.tsx")).toThrow();
  });

  it("the three untested dead instagramAdmin procs are deleted", () => {
    const router = read("server/routers/instagramAdmin.ts");
    for (const proc of ["getAccountInfo:", "reconnectToken:", "generatePost:"]) {
      expect(router).not.toContain(proc);
    }
    // Live/tested endpoints must SURVIVE the cut: generatePostDraft (legacy
    // Studio) and finalizeReelDraft (approval-integrity E2E contract — its
    // deletion broke the pipeline test and was reverted same-day).
    expect(router).toContain("generatePostDraft:");
    expect(router).toContain("finalizeReelDraft:");
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
