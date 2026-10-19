/**
 * vt-render · the page-render helper of the v3 gate (2026-10-15, UI v3 W0b).
 *
 * DEBT: renderPage below started as a COPY of renderPage in
 * tests/e2e/visible-transformation.spec.ts (the v2 gate), which stays untouched
 * for this wave. A baseline is only comparable with a later render if both were
 * taken with the same settle logic, so keep the two in step until the v2 spec is
 * retired, then delete the copy there. Additions over v2: VT_CONTEXT, the
 * anchor/error wait (a fixture render must show its DEMO anchor and none of the
 * page's error states BEFORE it settles and is captured), and warmRoutes passing
 * baseURL (a manually created context gets no config `use` options; without it
 * `page.goto("/")` rejects and the v2 warm loop warms nothing).
 *
 * The v2 header explains the settle logic; the short version: a capture taken
 * while a skeleton is on screen measures a placeholder, so the page must leave
 * its loading state (placeholder AREA under 1.5% of the viewport) or the
 * capture fails loudly instead of measuring.
 */
import { expect, type Browser, type Page } from "@playwright/test";

import { installFixtures } from "./fixtures";

/** The server under test; the same default playwright.config.ts uses. */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

/**
 * Locale and timezone the fixture renders are taken in. v2 baselines took the
 * runner's defaults; the fixtures describe a clock in America/New_York, and a
 * date label must not depend on which machine took the capture.
 */
export const VT_CONTEXT = { locale: "en-US", timezoneId: "America/New_York" } as const;

/**
 * Dev-only React hydration mismatches are recovered by a client re-render and
 * never reach production as a thrown error; they are a separate defect class
 * (tracked, not gated here). Every other uncaught error fails the capture.
 */
export const IGNORED_PAGE_ERRORS = /hydration/i;

/**
 * Wave 0b covered Home and Missions; W3a adds Chat; the W4 gate job (2026-10-19) adds Brain, People,
 * Journal and Stats; System comes later.
 *
 * `baselinePending`: the page renders from fixtures on every run (anchor, error
 * states, unstubbed reads all gate), but its frozen baseline has not been
 * captured yet, so a MISSING PNG skips the distance comparison with a reason
 * instead of failing (baselineSkipReason in ./v3-gate.ts). Chat's pre-W3
 * baselines were captured from main 7dc82474c (run 38908095706) and committed
 * with the flag removed in the same commit; the four W4 pages are pending until
 * theirs are; tests/repo/v3-gate.test.ts fails if a flagged page already has its PNGs.
 */
export const V3_PAGES: { key: string; path: string; landmark: string; baselinePending?: boolean }[] = [
  { key: "home", path: "/", landmark: "main" },
  { key: "missions", path: "/missions", landmark: "main" },
  // ?h=1 opens the History drawer, the only way a conversation loads (openChatHistory above).
  { key: "chat", path: "/chat?h=1", landmark: "main" },
  // W4 Mind (2026-10-19), pending until their PRE-W4 baselines (651ded614 + this instrument) are committed.
  // Brain renders its Board tab: the default Map is a Math.random-seeded canvas (fixtures/brain.ts).
  { key: "brain", path: "/brain?tab=board", landmark: "main", baselinePending: true },
  { key: "people", path: "/people", landmark: "main", baselinePending: true },
  { key: "journal", path: "/journal", landmark: "main", baselinePending: true },
  { key: "stats", path: "/stats", landmark: "main", baselinePending: true },
];

export const V3_VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "phone", width: 390, height: 844 },
];

export interface RenderAnchor {
  /** Text that exists only in the fixtures; it must be visible before the capture. */
  anchorText: string;
  /** The page's own error states; none may be on screen before the capture. */
  errorPattern: RegExp;
  /** A step the page needs before its anchor can appear (Chat: pick the seeded conversation). Runs once the page has loaded. */
  open?: (page: Page) => Promise<void>;
  /** A step that waits for the page's own settling work, after the anchor and the error check (Chat: the island's height and the jump button). */
  settle?: (page: Page) => Promise<void>;
}

/**
 * Chat opens on an empty composer: it never loads a conversation by itself
 * ("no auto-resume, user picks from history", hooks/use-conversations.ts).
 * `/chat?h=1` opens the History drawer once React has hydrated
 * (use-chat-deep-link-prefill.ts), so the title being visible also means the
 * click handlers are attached. Picking the row loads the conversation and
 * closes the drawer.
 */
export async function openChatHistory(page: Page, title: string): Promise<void> {
  const row = page.getByText(title).first();
  await expect(row, "chat: the seeded conversation never reached the History drawer").toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.getByRole("button", { name: "Close history" }), "chat: the History drawer never closed after the pick").toHaveCount(0);
}

/**
 * What Chat does after its content lands, that a capture must not race:
 * the header pill reads a MEASURED state ("ready"), the jump-to-latest button
 * is not on screen (it shows while the list is mid-scroll to the newest
 * message), and the island's height has stopped moving (the visualViewport
 * sync and the shell's measured bottom reservation both resize it after
 * mount, chat-island.tsx). Three equal reads 250ms apart is the stop.
 */
export async function settleChat(page: Page): Promise<void> {
  // W3b: the indicator is a dot plus words; its accessible name is `${label} (capability health)`
  // (chat-capability-indicator.tsx), so "ready" is the measured state here as before.
  await expect(page.getByRole("link", { name: "ready (capability health)", exact: true }), "chat: the header indicator never reached a measured state").toBeVisible({ timeout: 30_000 });
  const island = page.locator("[data-chat-shell] > div").first();
  const reads: number[] = [];
  await expect
    .poll(
      async () => {
        const height = await island.evaluate((el) => Math.round(el.getBoundingClientRect().height));
        reads.push(height);
        return reads.length >= 3 && reads.slice(-3).every((h) => h === height);
      },
      { message: "chat: the island's height never stopped moving", intervals: [250], timeout: 20_000 },
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Scroll to latest message" }), "chat: the jump-to-latest button is still on screen").toHaveCount(0);
}

export async function renderPage(page: Page, route: string, landmark: string, anchor: RenderAnchor): Promise<Buffer> {
  // A page that threw is not a page: uncaught errors fail the capture. (The dev
  // overlay host <nextjs-portal> exists on EVERY dev render, so its presence
  // proves nothing: listen for the errors themselves.)
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    if (!IGNORED_PAGE_ERRORS.test(err.message)) pageErrors.push(err.message);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${route} must respond 200`).toBe(200);
  await expect(page.locator(landmark).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/application error/i)).toHaveCount(0);
  // Let the first data round-trip land (a deck skeleton is not the deck), then
  // let fonts settle without waiting on the pollers.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // It must be THE FIXTURE RENDER before it is allowed to settle and be captured:
  // the DEMO anchor on screen, none of the page's error states. A late
  // hydration that would otherwise freeze a loading buffer into a baseline
  // fails here instead. (A page that needs a step before its anchor can show,
  // Chat's conversation pick, declares it as anchor.open.)
  await anchor.open?.(page);
  await expect(page.getByText(anchor.anchorText).first(), `${route}: fixture anchor text never appeared`).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(anchor.errorPattern), `${route}: rendered one of its error states`).toHaveCount(0);
  await anchor.settle?.(page);
  // ...and for the placeholders to leave: a skeleton root (`data-skeleton`), a
  // busy region (`aria-busy`) or a pulsing placeholder still on screen means the
  // capture would measure loading chrome, not the page. "Settled" is measured by
  // AREA, not by count: a pulsing 8px status dot is not loading chrome, a 700x80
  // skeleton block is. Placeholders covering more than 1.5% of the viewport keep
  // the page in its loading state.
  const settled = await page
    .waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-skeleton], [aria-busy="true"], .animate-pulse');
        let area = 0;
        for (const el of els) {
          const r = (el as HTMLElement).getBoundingClientRect();
          area += Math.max(0, r.width) * Math.max(0, r.height);
        }
        return area / (window.innerWidth * window.innerHeight) < 0.015;
      },
      undefined,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  expect(settled, `${route} never left its loading state within 60s: not measured`).toBe(true);
  await page.waitForTimeout(1500);
  expect(pageErrors, `${route} threw during render`).toEqual([]);
  return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
}

/**
 * Warm every route once before measuring. `next dev` compiles a route on its
 * first hit after any edit, and a capture that races that compile lands while
 * the page is still hydrating. Warming is not measuring: nothing is compared,
 * but every warm hit must answer 200, or the capture would be the first real
 * request. Fixtures are installed so the warm-up never reads the (empty)
 * database. baseURL is passed explicitly: a context made with
 * browser.newContext() does not inherit the config's `use` options.
 */
export async function warmRoutes(
  browser: Browser,
  viewport: { width: number; height: number },
  paths: string[],
): Promise<void> {
  const ctx = await browser.newContext({ viewport, baseURL: E2E_BASE_URL, ...VT_CONTEXT });
  const page = await ctx.newPage();
  await installFixtures(page);
  for (const p of paths) {
    const res = await page.goto(p, { waitUntil: "domcontentloaded", timeout: 180_000 });
    expect(res?.status(), `warm-up: ${p} must respond 200`).toBe(200);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }
  await ctx.close();
}
