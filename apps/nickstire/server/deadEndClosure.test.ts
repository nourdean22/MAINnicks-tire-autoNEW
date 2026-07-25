/**
 * Dead-end closure pins (2026-07-25) — the batch that removed the admin's
 * silent dead ends. Each block pins one fix so it cannot quietly regress:
 *
 * 1. Tire orders soft-cancel (hard DELETE hid refund risk from cancellationRisks)
 * 2. GBP OAuth exchange at the SHELL level (sub-tab-only effect expired codes)
 * 3. highlightId removed (dispatched for a year with zero receivers)
 * 4. Campaigns N+1 collapsed into the list query
 * 5. Shop-floor polling respects hidden tabs
 * 6. Command Search stops asserting stale money figures
 * 7. Money + Content & AI have visible sidebar doors (iPhone has no Cmd+K)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("tire orders cancel instead of vanishing", () => {
  it("gatewayTire has no hard DELETE of tire_orders — cancelOrder soft-cancels with an affectedRows check", () => {
    const s = read("server/routers/gatewayTire.ts");
    expect(s).not.toMatch(/\.delete\(tireOrders\)/);
    expect(s).toMatch(/cancelOrder: adminProcedure/);
    expect(s).toMatch(/set\(\{ status: "cancelled" \}\)/);
    expect(s).toMatch(/affectedRowCount\(res\) === 0/);
  });

  it("the client confirm says cancel-and-keep, not permanently-delete", () => {
    const s = read("client/src/pages/admin/TireOrdersSection.tsx");
    expect(s).not.toMatch(/permanently delete/i);
    expect(s).toMatch(/stays in history/);
    expect(s).toMatch(/gatewayTire\.cancelOrder/);
  });
});

describe("GBP OAuth exchange lives at the shell", () => {
  it("Admin.tsx mounts GbpOAuthCatcher unconditionally", () => {
    const s = read("client/src/pages/Admin.tsx");
    expect(s).toMatch(/<GbpOAuthCatcher \/>/);
  });

  it("the catcher scrubs the single-use code from the URL BEFORE firing the exchange", () => {
    const s = read("client/src/pages/admin/content/GbpOAuthCatcher.tsx");
    const scrub = s.indexOf('params.delete("code")');
    const fire = s.indexOf("reconnect.mutate({ code })");
    expect(scrub).toBeGreaterThan(-1);
    expect(fire).toBeGreaterThan(scrub);
  });

  it("GBPPostGenerator no longer runs its own sub-tab-only exchange effect", () => {
    const s = read("client/src/pages/admin/content/GBPPostGenerator.tsx");
    expect(s).not.toMatch(/reconnectMutation/);
    expect(s).not.toMatch(/params\.get\("code"\)/);
  });
});

describe("highlightId is gone, not dormant", () => {
  it("no client code dispatches or types a highlightId payload", () => {
    expect(read("client/src/pages/admin/shared/navigation.ts")).not.toMatch(/highlightId\??:/);
    expect(read("client/src/pages/admin/OverviewSection.tsx")).not.toMatch(/highlightId/);
  });
});

describe("campaign stats arrive with the list — no per-row queries", () => {
  it("campaigns.list carries grouped send stats in one query", () => {
    const s = read("server/routers/campaigns.ts");
    expect(s).toMatch(/groupBy\(smsCampaignSends\.campaignId\)/);
    expect(s).toMatch(/inArray\(smsCampaignSends\.campaignId/);
  });

  it("CampaignRow renders campaign.stats and never fires getById", () => {
    const s = read("client/src/pages/admin/outreach/CampaignsSection.tsx");
    expect(s).not.toMatch(/getById\.useQuery/);
    expect(s).toMatch(/campaign\.stats\?\.failed/);
  });
});

describe("shop-floor polling respects hidden tabs", () => {
  it("every DispatchSection interval sets refetchIntervalInBackground: false", () => {
    const s = read("client/src/pages/admin/money/DispatchSection.tsx");
    const intervals = (s.match(/refetchInterval:/g) ?? []).length;
    const backgroundFlags = (s.match(/refetchIntervalInBackground: false/g) ?? []).length;
    expect(intervals).toBeGreaterThan(0);
    expect(backgroundFlags).toBe(intervals);
  });
});

describe("Command Search asserts no stale money figures", () => {
  it("no hardcoded dollar amounts or estimate counts in command labels", () => {
    const s = read("client/src/components/admin/CommandSearch.tsx");
    expect(s).not.toMatch(/\$321K/);
    expect(s).not.toMatch(/\$47K|"47k"|"47K"/);
    expect(s).not.toMatch(/84 estimates/);
  });

  it("the VIP command applies a real filter via ?minVisits=3", () => {
    expect(read("client/src/components/admin/CommandSearch.tsx")).toMatch(/minVisits=3/);
    expect(read("client/src/pages/admin/customers/CustomersList.tsx")).toMatch(/get\("minVisits"\)/);
  });

  it("the lying declined-cohort command is deleted, not relabeled", () => {
    expect(read("client/src/components/admin/CommandSearch.tsx")).not.toMatch(/action-customers-declined/);
  });
});

describe("Money and Content & AI have sidebar doors", () => {
  it("both registry entries are showInSidebar: true", () => {
    const s = read("client/src/pages/admin/registry.tsx");
    for (const id of ["revenue", "content"]) {
      const entry = s.slice(s.indexOf(`id: "${id}"`));
      const block = entry.slice(0, entry.indexOf("},"));
      expect(block).toMatch(/showInSidebar: true/);
    }
  });
});
