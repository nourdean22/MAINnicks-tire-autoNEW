import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { collectFirstPartyErrors } from "./helpers";

const STORAGE_STATE = process.env.E2E_ADMIN_STORAGE_STATE;
test.use(STORAGE_STATE ? { storageState: STORAGE_STATE } : {});

// Four primary tabs (Today, Create, Queue = publish, Learn = insights); Controls and Strategy sit behind the gear.
const VIEWS = ["today", "create", "publish", "insights", "controls", "strategy"] as const;
const PRIMARY_LABELS = ["Today", "Create", "Queue", "Learn"];
// Old ?igview= values that no longer exist, and where igViews.ts sends them.
const LEGACY = [
  { old: "community", lands: "today" },
  { old: "planning", lands: "create" },
  { old: "pipeline", lands: "controls" },
] as const;

test.beforeEach(() => {
  test.skip(!STORAGE_STATE, "E2E_ADMIN_STORAGE_STATE is required for authenticated admin visual QA");
});

for (const view of VIEWS) {
  test("Instagram admin " + view + " is operable and screenshots cleanly", async ({ page }, info) => {
    const errors = collectFirstPartyErrors(page);
    await page.goto("/admin?tab=instagram&igview=" + view, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Instagram", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Sign in", { exact: true })).toHaveCount(0);
    const primaryTabs = page.locator('[role="tab"]');
    await expect(primaryTabs).toHaveCount(4);
    expect(await primaryTabs.allTextContents()).toEqual(PRIMARY_LABELS);
    const boxes = await primaryTabs.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }));
    for (const box of boxes) {
      expect(box.height, "primary Instagram tab tap target height").toBeGreaterThanOrEqual(40);
      expect(box.width, "primary Instagram tab has a real hit target").toBeGreaterThan(20);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, "no horizontal page overflow").toBeLessThanOrEqual(overflow.clientWidth + 2);

    mkdirSync("test-results/argos", { recursive: true });
    await page.screenshot({
      path: "test-results/argos/admin-instagram-" + view + "-" + info.project.name + ".png",
      fullPage: false,
      animations: "disabled",
      mask: [page.locator("video"), page.locator("iframe"), page.locator("[aria-live]")],
    });

    expect(errors, "no first-party runtime/tRPC errors").toEqual([]);
  });
}

for (const { old, lands } of LEGACY) {
  test("Instagram admin legacy igview=" + old + " lands on " + lands, async ({ page }) => {
    await page.goto("/admin?tab=instagram&igview=" + old, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Instagram", exact: true })).toBeVisible({ timeout: 20_000 });
    if (lands === "today") {
      await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
    } else if (lands === "create") {
      await expect(page.getByRole("tab", { name: "Create" })).toHaveAttribute("aria-selected", "true");
    } else {
      // Controls is behind the gear: no primary tab is selected and the back link is shown.
      await expect(page.getByRole("button", { name: /Back to Today/ })).toBeVisible();
    }
  });
}
