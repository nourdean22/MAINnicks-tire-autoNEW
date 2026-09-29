import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const STORAGE_STATE = process.env.E2E_ADMIN_STORAGE_STATE;
test.use(STORAGE_STATE ? { storageState: STORAGE_STATE } : {});

const VIEWS = ["today", "create", "publish", "community", "insights", "strategy"] as const;

function collectFirstPartyErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/TRPCClientError|\/api\/|\/trpc\//.test(text)) errors.push("console: " + text);
  });
  return errors;
}

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
    await expect(primaryTabs).toHaveCount(5);
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
