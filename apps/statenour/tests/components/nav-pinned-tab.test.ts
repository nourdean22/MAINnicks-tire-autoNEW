/**
 * UI v3 W1b: the fourth bottom slot is a pinned slot (default Journal). Pure resolution over NAV:
 * a stored href that is a flat More row (or Journal itself) wins; anything stale, unknown, a hub,
 * the footer or one of the three fixed tabs falls back to Journal. The More sheet drops the pinned
 * entry from its rows and shows Journal there instead.
 */
import { describe, expect, it } from "vitest";
import { NAV, FIXED_TABS, moreRows, resolvePinnedTab, isPinnable, DEFAULT_PINNED_HREF } from "@/components/layout/nav-items";

const hrefs = (rows: { href: string }[]) => rows.map((r) => r.href);

describe("resolvePinnedTab", () => {
  it("default is Journal", () => {
    expect(DEFAULT_PINNED_HREF).toBe("/journal");
    expect(resolvePinnedTab(null, NAV).href).toBe("/journal");
    expect(resolvePinnedTab(undefined, NAV).href).toBe("/journal");
    expect(resolvePinnedTab("", NAV).href).toBe("/journal");
  });

  it("a flat More row can be pinned", () => {
    expect(resolvePinnedTab("/stats", NAV).label).toBe("Stats");
    expect(resolvePinnedTab("/people", NAV).label).toBe("People");
  });

  it("pinning Journal is the default again", () => {
    expect(resolvePinnedTab("/journal", NAV).href).toBe("/journal");
  });

  it("a stale or unknown href falls back to Journal", () => {
    expect(resolvePinnedTab("/market", NAV).href).toBe("/journal");
    // Pages cut 2026-10-19: a bar that stored one of them must open Journal, not an empty slot.
    expect(resolvePinnedTab("/proof", NAV).href).toBe("/journal");
    expect(resolvePinnedTab("/pins", NAV).href).toBe("/journal");
    expect(resolvePinnedTab("not a path", NAV).href).toBe("/journal");
  });

  it("a hub, the footer and the three fixed tabs cannot take the slot", () => {
    expect(resolvePinnedTab("/brain", NAV).href).toBe("/journal");
    expect(resolvePinnedTab("/system", NAV).href).toBe("/journal");
    expect(resolvePinnedTab("/settings", NAV).href).toBe("/journal");
    for (const fixed of FIXED_TABS) expect(resolvePinnedTab(fixed.href, NAV).href).toBe("/journal");
  });

  it("the fixed slots are Home, Chat, Missions in bar order", () => {
    expect(hrefs(FIXED_TABS)).toEqual(["/", "/chat", "/missions"]);
  });

  it("isPinnable agrees with the resolver on every NAV entry", () => {
    for (const n of NAV) {
      expect(resolvePinnedTab(n.href, NAV).href === n.href, n.href).toBe(isPinnable(n));
    }
  });
});

describe("moreRows", () => {
  it("with the default pin the rows are the section minus bottom tabs and footer (Journal is in the bar, not the sheet)", () => {
    for (const s of ["capture", "execute", "reflect", "operate"] as const) {
      expect(hrefs(moreRows(s, "/journal"))).toEqual(hrefs(NAV.filter((n) => n.section === s && !n.bottomTab && !n.footer)));
    }
    expect(hrefs(moreRows("reflect", "/journal"))).not.toContain("/journal");
  });

  it("the pinned entry leaves its section and Journal appears in Reflect", () => {
    const reflect = hrefs(moreRows("reflect", "/stats"));
    expect(reflect).not.toContain("/stats");
    expect(reflect).toContain("/journal");
    expect(reflect).toContain("/people");
  });

  it("pinning a row from another section still puts Journal in Reflect, and only there", () => {
    expect(hrefs(moreRows("execute", "/learn"))).not.toContain("/learn");
    expect(hrefs(moreRows("reflect", "/learn"))).toContain("/journal");
    expect(hrefs(moreRows("capture", "/learn"))).not.toContain("/journal");
  });

  it("the fixed tabs and the footer never appear as rows", () => {
    for (const s of ["capture", "execute", "reflect", "operate"] as const) {
      const rows = hrefs(moreRows(s, "/stats"));
      expect(rows).not.toContain("/");
      expect(rows).not.toContain("/chat");
      expect(rows).not.toContain("/missions");
      expect(rows).not.toContain("/settings");
    }
  });
});
