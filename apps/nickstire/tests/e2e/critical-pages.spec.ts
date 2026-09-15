/**
 * Tier-1 critical pages — docs/eval-rubrics/visual-regression.md, made real.
 *
 * Per page x viewport: the page loads without a runtime error, carries exactly
 * one h1, every image has alt text, the document has a lang, and a screenshot
 * is written to test-results/argos/ for Argos to diff against the previous
 * build (uploaded by .github/workflows/nickstire-proof.yml when ARGOS_TOKEN is
 * set; kept as a plain artifact otherwise). Pixel comparison is Argos's job —
 * a committed-baseline toHaveScreenshot against a LIVE site would churn on
 * every real content change and get updated blind, the anti-pattern the spec
 * warns about.
 *
 * Dynamic regions (live visitor count, activity ticker, weather banner) are
 * masked so a legitimately changing number is not a "regression".
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const PAGES = [
  { path: "/", name: "home" },
  { path: "/tires", name: "tires" },
  { path: "/brakes", name: "brakes" },
  { path: "/financing", name: "financing" },
  { path: "/booking", name: "booking" },
] as const;

// Live regions the storefront legitimately changes minute to minute. Each
// selector is one the components actually render (data-testid added on the
// widgets in this wave; role/aria-live covers the shop status + visitor
// counter's own attributes) — a mask that matches nothing is a silent no-op.
const DYNAMIC = [
  '[data-testid="weather-banner"]',
  '[data-testid="shop-status-widget"]',
  '[data-testid="live-visitor-counter"]',
  '[role="status"]',
  "[aria-live]",
  "iframe",
  "video",
];

/**
 * First-party runtime errors only. A third-party resource that fails to load
 * (fonts.googleapis.com behind a filtering network, a blocked pixel, a
 * favicon) is the runner's environment, not the storefront's defect — but an
 * uncaught exception or a failed call to our own API is.
 */
async function collectRuntimeErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/TRPCClientError|\/api\/|\/trpc\//.test(text)) errors.push(`console: ${text}`);
  });
  return errors;
}

for (const p of PAGES) {
  test(`${p.name} ${p.path} renders, is accessible, and is screenshotted`, async ({ page }, info) => {
    const errors = await collectRuntimeErrors(page);
    await page.goto(p.path, { waitUntil: "networkidle" });
    await page.waitForSelector("h1", { timeout: 20_000 });

    expect(await page.locator("h1").count(), "exactly one h1").toBe(1);
    expect(await page.locator("img:not([alt])").count(), "every image has alt").toBe(0);
    expect(await page.getAttribute("html", "lang"), "html[lang]").toBeTruthy();
    // The shop phone is the storefront's primary conversion path on every Tier-1 page.
    expect(await page.locator('a[href^="tel:"]').count(), "a tel: link exists").toBeGreaterThan(0);

    mkdirSync("test-results/argos", { recursive: true });
    await page.screenshot({
      path: `test-results/argos/${p.name}-${info.project.name}.png`,
      fullPage: false,
      animations: "disabled",
      mask: DYNAMIC.map((s) => page.locator(s)),
    });

    expect(errors, "no runtime errors").toEqual([]);
  });
}
