import { afterEach, describe, expect, it, vi } from "vitest";

// services.ts decides the coupon clause when the module loads: the client per
// page load, the server per deploy, the prerenderer per regen. After the last
// day the oil copy must drop the code AND the instruction to mention it; until
// 2026-10-01 a static "Mention the code when you arrive." would have outlived
// the code it pointed at.
async function oilCopyAt(iso: string): Promise<string> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  vi.resetModules();
  const { SERVICES } = await import("./services");
  const { OIL_COUPON } = await import("./pricing");
  const oil = SERVICES.find((s) => s.slug === "oil-change");
  expect(oil).toBeDefined();
  return JSON.stringify(oil).replaceAll(OIL_COUPON.code, "<CODE>");
}

describe("oil-change copy and the coupon's last day", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("names the code, and asks for it, through the last day in Cleveland", async () => {
    // 6pm ET on 2026-12-31 is 23:00Z, still the last day
    const copy = await oilCopyAt("2026-12-31T23:00:00Z");
    expect(copy).toContain("with coupon code <CODE>");
    expect(copy).toMatch(/mention the code/i);
  });

  it("drops the code and the instruction to mention it the day after", async () => {
    const copy = await oilCopyAt("2027-01-01T17:00:00Z");
    expect(copy).not.toContain("<CODE>");
    expect(copy).not.toMatch(/mention the code/i);
  });
});
