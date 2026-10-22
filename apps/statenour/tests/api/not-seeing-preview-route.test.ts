/**
 * GET /api/brain/not-seeing (2026-10-22): owner-only preview of the weekly
 * section. On a cold process the Settings-panel overrides must be loaded
 * before the route reports whether the section is in the Monday brief.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loaded: false,
  auth: undefined as unknown,
  build: vi.fn(async () => ({ lines: ["<b>What you're not seeing</b>", "· business: a gap"], payload: { gapsShown: 1 } })),
}));

vi.mock("@/lib/utils/http", () => ({
  apiHandler: (fn: () => unknown, opts: unknown) => {
    h.auth = opts;
    return fn;
  },
}));
vi.mock("@/lib/services/not-seeing-note", () => ({ buildNotSeeingSlice: h.build }));
vi.mock("@/lib/feature-flags", () => ({
  loadFeatureFlagOverrides: async () => {
    h.loaded = true;
  },
  // The override says ON; before it is loaded, getFlag sees env only (OFF).
  getFlag: () => ({ isOn: h.loaded }),
}));

import { GET } from "@/app/api/brain/not-seeing/route";

const run = async () => (await (GET as unknown as () => Promise<Record<string, unknown>>)()) as {
  text: string;
  inMondayBrief: boolean;
};

beforeEach(() => {
  h.loaded = false;
});

describe("GET /api/brain/not-seeing", () => {
  it("is owner-only", () => {
    expect(h.auth).toEqual({ auth: "owner" });
  });

  it("reports the Settings-panel switch even on a cold process", async () => {
    const out = await run();
    expect(out.inMondayBrief).toBe(true);
    expect(out.text).toContain("· business: a gap");
  });
});
