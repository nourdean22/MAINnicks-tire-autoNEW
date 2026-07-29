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
    // "patterns" joined 2026-07-29 (Pattern Lab, Wave C′) — a deliberate
    // registry addition; this pin exists to catch ACCIDENTAL drift.
    expect(IG_SECONDARY_VIEWS.map((v) => v.key)).toEqual(["planning", "patterns", "actions", "control", "settings"]);
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

describe("cross-view handoffs carry real context (Wave 5)", () => {
  it("Community's Create Post writes the handoff (theme + sample + count), not a bare tab switch", () => {
    const inbox = read("client/src/pages/admin/instagram/Inbox.tsx");
    expect(inbox).toMatch(/writeCreateHandoff\(\{/);
    expect(inbox).toMatch(/cluster\.sample/);
  });

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

describe("Community + Insights honesty (Wave 7)", () => {
  it("the feed list has a real error state — a failed query no longer renders as 'No posts cached'", () => {
    const inbox = read("client/src/pages/admin/instagram/Inbox.tsx");
    expect(inbox).toMatch(/feedError \?/);
    expect(inbox).toMatch(/unknown<\/strong>, not empty/);
  });

  it("comments triage by unanswered-first filter chips", () => {
    expect(read("client/src/pages/admin/instagram/Inbox.tsx")).toMatch(/commentFilter/);
  });

  it("an unanswered question in the comments hands its TEXT to Create", () => {
    const inbox = read("client/src/pages/admin/instagram/Inbox.tsx");
    expect(inbox).toMatch(/sourceType: "customer_question"/);
    expect(inbox).toMatch(/comment\.text\.slice/);
  });

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

  it("Planning's Open-in-Studio rides the handoff contract, not the dead ?briefId redirect", () => {
    const panel = read("client/src/pages/admin/DraftBoardPanel.tsx");
    expect(panel).toMatch(/writeCreateHandoff/);
    // No template-literal navigation writer building a briefId URL remains
    // (the historical note in a comment is allowed to mention it).
    expect(panel).not.toMatch(/window\.location\.href = `/);
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
