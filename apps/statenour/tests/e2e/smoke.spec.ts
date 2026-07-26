/**
 * E2E smoke tests — verify the daily surfaces load, are AUTHENTICATED, render
 * their own page identity + critical content, and throw no runtime errors.
 *
 * Runs against a running dev server (default localhost:3001) or a deployed
 * preview via E2E_BASE_URL.
 *
 * CI GATE (2026-07-25 · closes truth-substrate audit P0 #8/#10): this suite
 * IS wired into CI — .github/workflows/e2e-statenour.yml runs it BLOCKING on
 * every statenour PR against a HERMETIC build: throwaway pgvector Postgres
 * service + `prisma db push` (empty data) + real `next build`/`next start` +
 * AUTH_FORCE_MOCK=1 for the authenticated session. No operator secrets, no
 * prod URL — the storageState variant against live bdnick.info remains an
 * optional operator-keyed extra, not a prerequisite. Locally these still run
 * manually: pnpm test:e2e (against a running app / E2E_BASE_URL).
 * Assertions must therefore stay EMPTY-DATA TOLERANT (labels and shapes, not
 * row counts).
 */

import { test, expect } from "@playwright/test";

// ── Pages render without runtime errors ───────────────────────────
//
// 2026-07-25 route repair: five PAGES entries (plus the standalone
// /brain/wisdom goto below) pointed at pages deleted in the 2026-05/06
// mega-delete + IA reorg. Four of them (/system/costs, /system/prompt,
// /plan, /system/performance) ride next.config.ts redirects to their
// consolidated surfaces — so the old tests landed on a DIFFERENT page
// whose identity could never match; /intel had no page AND no redirect,
// a genuine 404. Entries now target the live surfaces directly. The
// `title` regex is a page-IDENTITY check matched against document.title
// OR the h1 heading: the root layout sets a flat "NOUR OS" <title> and,
// of the pages listed here, only /chat exports its own metadata (a few
// others exist app-wide, e.g. /warroom), so most pages carry their
// identity in the StandardPage/PageHeader h1, not the document title.

const PAGES = [
  { path: "/", title: /NOUR OS|Ultron|HQ/i },
  { path: "/chat", title: /Nick|Chat/i },
  { path: "/system", title: /system/i },
  { path: "/system/ai-cost", title: /ai cost/i },
  // 2026-07-25 hermetic-CI: /intelligence/brief server-renders an
  // AI-GENERATED brief — with a dummy provider key the RSC stream never
  // completes and page.goto hangs (proven in e2e run 6). AI-dependent
  // surfaces are the operator-keyed extra; /missions covers the core
  // execution surface hermetically instead.
  { path: "/missions", title: /Missions/i },
  { path: "/content?tab=history", title: /Content/i },
  { path: "/pins", title: /pinned memory|Pins/i },
  { path: "/stats", title: /Stats/i },
  { path: "/content?tab=publish", title: /Content/i },
  { path: "/photo-improver", title: /photo improver/i },
  { path: "/brain?tab=wisdom", title: /Brain/i },
  { path: "/system/cockpit-observability", title: /cockpit observability|Observability/i },
  { path: "/system/health", title: /os health|Health/i },
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
    // (3) Page-specific identity — document title OR h1 heading matches.
    // (Most pages have the global "NOUR OS" <title>; identity lives in h1.)
    // 2026-07-25 · polled: on the 2-core CI runner the h1 can hydrate a
    // beat after the heading/main gate above passes (seen on
    // /system/health — h1 read back empty, then passed on retry). Same
    // assertion, retried up to 15s instead of a single snapshot read.
    await expect(async () => {
      const docTitle = await page.title();
      const h1Text =
        (await page.locator("h1").first().textContent().catch(() => "")) ?? "";
      expect(
        `${docTitle} ${h1Text}`,
        `${p.path} identity mismatch — title "${docTitle}" / h1 "${h1Text}"`,
      ).toMatch(p.title);
    }).toPass({ timeout: 15_000 });
    // (4) No JS-throwing errors.
    expect(errors, `runtime errors on ${p.path}`).toEqual([]);
  });
}

// ── API contracts ─────────────────────────────────────────────────

const API_ENDPOINTS = [
  // 2026-07-25 route repair: `system.rateLimits` and `system.observability`
  // tRPC procedures no longer exist — rate limits moved to the REST route
  // /api/system/rate-limits and observability to the top-level
  // `observability` router (osSnapshot).
  { method: "GET", path: "/api/system/rate-limits", expectKeys: ["tone", "label", "providers"] },
  { method: "GET", path: "/api/trpc/system.costs?input=" + encodeURIComponent(JSON.stringify({ days: 7 })), expectKeys: ["result"] },
  // 2026-07-25 empty-tolerance (the header's own rule): on an empty DB
  // /api/intel returns { ok, industry: [], generatedAt } and OMITS the
  // data-dependent keys (proven in e2e run 6) — pin the structural shape.
  { method: "GET", path: "/api/intel", expectKeys: ["ok", "industry", "generatedAt"] },
  { method: "GET", path: "/api/content/history?days=30", expectKeys: ["count", "rows", "stats"] },
  { method: "GET", path: "/api/social/recent-images", expectKeys: ["images"] },
  { method: "GET", path: "/api/brain/wisdom", expectKeys: ["total", "totalRecalls", "groupings"] },
  { method: "GET", path: "/api/trpc/observability.osSnapshot", expectKeys: ["result"] },
];

for (const e of API_ENDPOINTS) {
  test(`api ${e.method} ${e.path} responds with expected shape`, async ({ request }) => {
    // 2026-07-25 · 30s request budget: the assertion is about SHAPE, not
    // latency. Playwright's 10s default flaked when the dev server's
    // single-threaded webpack compiler was busy with a neighboring
    // page's modules (rate-limits timed out at 10s post-warmup while
    // /system/health compiled). Latency bounds belong to prod smoke.
    const res = await request.get(e.path, { timeout: 30_000 });
    expect(res.status(), `${e.path} status`).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of e.expectKeys) {
      expect(body, `${e.path} missing key '${key}'`).toHaveProperty(key);
    }
  });
}

// ── Chat critical-path: send message + verify stream lands ────────

// 2026-07-25 hermetic-CI: a REAL assistant reply requires a REAL
// provider key — the hermetic run uses presence-only dummies, so the
// stream can never produce one. This test remains the operator-keyed
// extra (set a real key + unset E2E_HERMETIC to run it in CI).
test("chat: send a message + assistant reply lands within 30s", async ({ page }) => {
  test.skip(process.env.E2E_HERMETIC === "1", "needs a real AI provider key — operator-keyed extra");
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
    // 2026-07-25 pin refresh: the #1035 composer restyle merged the
    // audio-drop + voice-mode pair into ONE "Voice input" mic button.
    "button[aria-label*='voice input' i]",
  );
  await expect(audioBtn).toBeVisible({ timeout: 5_000 });

  // (voice-mode button removed in #1035 — single Voice input mic now)
});

// ── v10.0.378 · brain wisdom dashboard renders cards ─────────────
//
// Verifies the wisdom dashboard mounts and shows top-line stats. If
// the API returns 401 or the StandardPage breaks, this catches it.

test("brain wisdom: dashboard renders top-line stats", async ({ page }) => {
  // 2026-07-25 route repair: the standalone /brain/wisdom page was folded
  // into the tabbed /brain surface — go straight to the wisdom tab rather
  // than riding the redirect.
  await page.goto("/brain?tab=wisdom");
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
