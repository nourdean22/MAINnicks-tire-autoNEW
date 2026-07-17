import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from the vitest root (apps/nickstire), NOT import.meta.url: this
// suite runs under jsdom where import.meta.url is an http:// URL, so
// fileURLToPath threw "The URL must be of scheme file" and the WHOLE suite
// failed at collection - the repo-wide red test since the admin waves.
const adminSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/Admin.tsx"),
  "utf8",
);

describe("admin shell operator-truth contract", () => {
  it("uses the shared overview bundle instead of parallel stats and callback polling", () => {
    expect(adminSource).toContain("adminDashboard.overviewMediumBundle.useQuery");
    expect(adminSource).not.toContain("adminDashboard.stats.useQuery");
    expect(adminSource).not.toContain("callback.list.useQuery");
  });

  it("uses canonical non-overlapping actionable counts", () => {
    expect(adminSource).toContain("getAdminActionableCounts");
    expect(adminSource).toContain('if (id === "overview") return counts.total');
  });

  it("surfaces unavailable and degraded data before section content", () => {
    const banner = adminSource.indexOf("<DegradedDataBanner");
    const content = adminSource.indexOf("<SectionContent");
    expect(banner).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(banner);
  });

  it("does not retain the extra grit/neutral appearance mode", () => {
    expect(adminSource).not.toContain("nickstire.adminTheme");
    expect(adminSource).not.toContain("data-admin-theme");
  });
});
