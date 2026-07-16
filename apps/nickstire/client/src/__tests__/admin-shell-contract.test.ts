import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adminSource = readFileSync(
  fileURLToPath(new URL("../pages/Admin.tsx", import.meta.url)),
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
