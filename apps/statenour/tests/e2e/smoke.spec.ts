/**
 * E2E smoke tests — verify the daily surfaces load, are AUTHENTICATED, render
 * their own page identity + critical content, and throw no runtime errors.
 *
 * Runs against a running dev server (default localhost:3001) or a deployed
 * preview via E2E_BASE_URL. truth-substrate audit P0 (#8/#10): this suite is
 * NOT wired into any gate today — vitest excludes tests/e2e/**, verify:hard
 * never invokes playwright, and no CI workflow runs it. Wiring it to gate ship
 * needs a deployed preview URL + a Playwright storageState (authenticated
 * session), which are operator/CI-secret setup. Until then these run manually:
 *   pnpm test:e2e            (against a running app / E2E_BASE_URL)
 * Do NOT claim E2E gates ship until that CI job + storageState exist.
 */

import { test, expect } from "@playwright/test";

// ── Pages render without runtime errors ───────────────────────────

const PAGES = [
  { path: "/", title: /NOUR OS|Ultron|HQ/i },
  { path: "/chat", title: /Nick|Chat/i },
  { path: "/system/costs", title: /AI Costs|Costs/i },
  { path: "/system/prompt", title: /System Prompt|Diagnostics/i },
  { path: "/intel", title: /Intel|Marketing/i },
  { path: "/content?tab=history", title: /Content/i },
  { path: "/pins", title: /Pinned Memory|Pins/i },
  { path: "/plan", title: /Day Planner|Plan/i },
  { path: "/content?tab=publish", title: /Content/i },
  { path: "/photo-improver", title: /Photo Improver/i },
  // v10.0.378 · added new surfaces shipped in this sprint
  { path: "/brain?tab=wisdom", title: /Brain/i },
  { path: "/system/performance", title: /Observability|Trace/i },
  { path: "/system/health", title: /Health|Grid/i },
];

for (const p of PAGES) {
  test(`page ${p.path} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Filter known-noisy expected warnings
        if (/hydration|punycode|next-auth/i.test(text)) return;
        errors.push(text);
      }
    });
    await page.goto(p.path, { waitUntil: "domcontentloaded" });
    // Generous time-out — dev server may need to compile. networkidle can
    // legitimately never settle on a polling page, so the WAIT may be skipped —
    // but the assertions below are NOT: they must run and pass.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    // truth-substrate audit #8: assert the page actually WORKED, not just that
    // no console error fired. Previously p.title was declared but never checked,
    // so a redirect-to-sign-in / blank shell / wrong page still passed.

    // (1) Authenticated + correct page — must NOT have bounced to sign-in/auth.
    expect(page.url(), `${p.path} redirected to auth (unauthenticated?)`).not.toMatch(
      /\/(sign-in|auth)(\/|\?|$)/,
    );
    // (2) Real content mounted — not a blank shell or error boundary.
    await expect(
      page.locator("h1, [role='heading'], main").first(),
      `${p.path} rendered no heading/main content`,
    ).toBeVisible({ timeout: 10_000 });
    // (3) Page-specific identity — the document title matches this page.
    await expect(page, `${p.path} wrong/mismatched <title>`).toHaveTitle(p.title);
    // (4) No JS-throwing errors.
    expect(errors, `runtime errors on ${p.path}`).toEqual([]);
  });
}

// ── API contracts ─────────────────────────────────────────────────

const API_ENDPOINTS = [
  { method: "GET", path: "/api/trpc/system.rateLimits", expectKeys: ["result"] },
  { method: "GET", path: "/api/trpc/system.costs?input=" + encodeURIComponent(JSON.stringify({ days: 7 })), expectKeys: ["result"] },
  { method: "GET", path: "/api/intel", expectKeys: ["industry", "stories", "performers"] },
  { method: "GET", path: "/api/content/history?days=30", expectKeys: ["count", "rows", "stats"] },
  { method: "GET", path: "/api/social/recent-images", expectKeys: ["images"] },
  // v10.0.378 · new API endpoints from this sprint
  { method: "GET", path: "/api/brain/wisdom", expectKeys: ["total", "totalRecalls", "groupings"] },
  { method: "GET", path: "/api/trpc/system.observability", expectKeys: ["result"] },
];

for (const e of API_ENDPOINTS) {
  test(`api ${e.method} ${e.path} responds with expected shape`, async ({ request }) => {
    const res = await request.get(e.path);
    expect(res.status(), `${e.path} status`).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of e.expectKeys) {
      expect(body, `${e.path} missing key '${key}'`).toHaveProperty(key);
    }
  });
}

// ── Chat critical-path: send message + verify stream lands ────────

test("chat: send a message + assistant reply lands within 30s", async ({ page }) => {
  await page.goto("/chat");
  await page.waitForSelector("textarea", { timeout: 10_000 });
  await page.fill("textarea", "ping — single word reply please");
  // Find + click the send button (varies by chat-page implementation)
  const sendBtn = page.locator("button[aria-label*='send' i], button:has(svg.lucide-arrow-up)").first();
  // Snapshot body text BEFORE the reply so we can require NEW content that is
  // not just the user's echoed input or site branding.
  const before = (await page.locator("body").innerText()).length;
  await sendBtn.click();
  // truth-substrate audit #8: the old heuristic accepted "ping" (the user's own
  // typed input) and "nick" (branding), so it passed even if the assistant never
  // replied. Now require a MEANINGFUL growth in body text beyond the sent
  // message — a reply actually landed.
  await page.waitForFunction(
    (beforeLen) => document.body.innerText.length > beforeLen + 120,
    before,
    { timeout: 30_000 },
  );
});

// ── Content-intent classifier sanity ──────────────────────────────

test("content-intent: post office is NOT classified as content", async ({ request }) => {
  const res = await request.get("/api/trpc/system.promptDiagnostics?input=" + encodeURIComponent(JSON.stringify({ msg: "the post office is closed today" })));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as any;
  const intent = body.result?.data?.intent;
  expect(intent?.isContent, "post office should be NOT-CONTENT").toBe(false);
  expect(intent?.confidence ?? 1).toBeLessThan(0.5);
});

test("content-intent: 'give me an instagram post' IS classified as content", async ({ request }) => {
  const res = await request.get("/api/trpc/system.promptDiagnostics?input=" + encodeURIComponent(JSON.stringify({ msg: "give me an instagram post for nicks tire" })));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as any;
  const intent = body.result?.data?.intent;
  expect(intent?.isContent, "instagram post should be CONTENT").toBe(true);
  expect(intent?.confidence ?? 0).toBeGreaterThan(0.7);
});

test("content-intent: 'for the gram' (slang) IS classified as content", async ({ request }) => {
  const res = await request.get("/api/trpc/system.promptDiagnostics?input=" + encodeURIComponent(JSON.stringify({ msg: "for the gram" })));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as any;
  const intent = body.result?.data?.intent;
  expect(intent?.isContent, "for the gram should be CONTENT").toBe(true);
});

// ── v10.0.378 · chat composer · new buttons mount ─────────────────
//
// Verifies that the audio-drop button (v10.0.349) and the voice-mode
// phone button (v10.0.359) render in the chat composer. This catches
// regressions where the import or the JSX get accidentally removed.

test("chat composer: audio drop + voice mode buttons present", async ({ page }) => {
  await page.goto("/chat");
  await page.waitForSelector("textarea", { timeout: 10_000 });

  // Audio attach button · aria-label includes 'audio'
  const audioBtn = page.locator(
    "button[aria-label*='audio file' i], button[aria-label*='Transcribing audio' i]",
  );
  await expect(audioBtn).toBeVisible({ timeout: 5_000 });

  // Voice mode (phone) button · aria-label includes 'voice mode'
  const voiceBtn = page.locator("button[aria-label*='voice mode' i]");
  await expect(voiceBtn).toBeVisible({ timeout: 5_000 });
});

// ── v10.0.378 · brain wisdom dashboard renders cards ─────────────
//
// Verifies the wisdom dashboard mounts and shows top-line stats. If
// the API returns 401 or the StandardPage breaks, this catches it.

test("brain wisdom: dashboard renders top-line stats", async ({ page }) => {
  await page.goto("/brain/wisdom");
  // Not bounced to auth.
  expect(page.url()).not.toMatch(/\/(sign-in|auth)(\/|\?|$)/);
  // Wait for the page-title h1 to render.
  await page.waitForSelector("h1", { timeout: 10_000 });
  // truth-substrate audit #8: this assertion was previously .catch()'d away, so
  // the test passed even when the wisdom stats never rendered (e.g. a 401 or a
  // broken StandardPage). The stats grid is the WHOLE point of this test — if
  // 'Total principles' never appears, that IS a failure. No swallow.
  await page.waitForFunction(
    () => /total principles/i.test(document.body.innerText),
    { timeout: 20_000 },
  );
});
