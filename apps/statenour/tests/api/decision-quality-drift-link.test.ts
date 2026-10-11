/**
 * The decision-quality-drift coach event linked /system/quality, a retired page kept alive only by a redirect in
 * next.config.ts (R3-08 concern 1). tests/repo/no-retired-redirect-links.test.ts sweeps lib/ and components/, not
 * app/api/, so this pins the one route. The cron is operator-parked; only its link changes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cfg = readFileSync("next.config.ts", "utf8");
const redirectSources = [...cfg.matchAll(/source:[ \t]*"([^"]+)",[ \t]*destination:/g)].map((m) => m[1]);
const src = readFileSync("app/api/cron/decision-quality-drift/route.ts", "utf8");
const deepLinks = [...src.matchAll(/deepLink:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("decision-quality-drift deep link", () => {
  it("control: /system/quality is a redirect source, so the check below can fail", () => {
    expect(redirectSources).toContain("/system/quality");
    expect(deepLinks.length).toBeGreaterThan(0);
  });

  it("links the live page directly, never a retired redirect", () => {
    for (const link of deepLinks) expect(redirectSources).not.toContain(link.split(/[?#]/)[0]);
    expect(deepLinks).toContain("/system/calibration");
  });
});
