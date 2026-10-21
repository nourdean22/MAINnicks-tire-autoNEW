/**
 * Instagram admin views after the W3 prune (2026-10-19).
 *
 * Community/Inbox, the Planning board and Pattern Lab were cut (no opens in 14 days of logs).
 * Pipeline health and Autonomy control stayed, merged into one Controls view, because they are
 * the only doors that stop autonomous posting and replies. Every ?igview= value that ever
 * shipped must still land somewhere sensible: a bookmark or a PWA relaunch must not strand.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  IG_PRIMARY_VIEWS, IG_SECONDARY_VIEWS, normalizeIgView, readIgViewFromUrl,
} from "@/pages/admin/instagram/igViews";

afterEach(() => window.history.replaceState({}, "", "/admin"));

describe("view vocabulary", () => {
  it("primary row: Today, Create, Queue, Learn", () => {
    expect(IG_PRIMARY_VIEWS.map((v) => [v.key, v.label])).toEqual([
      ["today", "Today"], ["create", "Create"], ["publish", "Queue"], ["insights", "Learn"],
    ]);
  });

  it("behind the gear: Controls first, then Strategy, Reel recovery, Settings", () => {
    expect(IG_SECONDARY_VIEWS.map((v) => [v.key, v.label])).toEqual([
      ["controls", "Controls"],
      ["strategy", "Strategy & profile"],
      ["actions", "Reel recovery (Action Center)"],
      ["settings", "Settings"],
    ]);
  });
});

describe("every old ?igview= value still lands somewhere", () => {
  // One row per key that ever existed: the cut views, the merged views, and the older aliases.
  it.each([
    ["community", "today"],
    ["inbox", "today"],
    ["planning", "create"],
    ["drafts", "create"],
    ["patterns", "today"],
    ["pipeline", "controls"],
    ["control", "controls"],
    ["hq", "today"],
    ["studio", "create"],
    ["queue", "publish"],
    ["learn", "insights"],
  ])("%s -> %s", (old, landing) => {
    expect(normalizeIgView(old)).toBe(landing);
  });

  it("every current view key passes through unchanged", () => {
    for (const { key } of [...IG_PRIMARY_VIEWS, ...IG_SECONDARY_VIEWS]) expect(normalizeIgView(key)).toBe(key);
  });

  it("unknown, empty and missing values land on today", () => {
    for (const raw of ["not-a-view", "", null, undefined, "CONTROL"]) expect(normalizeIgView(raw)).toBe("today");
  });

  it("the URL reader applies the same redirects", () => {
    window.history.replaceState({}, "", "/admin?tab=instagram&igview=pipeline");
    expect(readIgViewFromUrl()).toBe("controls");
    window.history.replaceState({}, "", "/admin?tab=instagram&igview=community");
    expect(readIgViewFromUrl()).toBe("today");
  });
});
