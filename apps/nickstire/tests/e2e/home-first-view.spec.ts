/**
 * Home first view on a phone: when does the GET TIRES NOW tile become visible, and how much of the
 * screen do fixed layers cover after a 600 px scroll? (job 2026-10-25-public-site-measures, ranked
 * item 3 of docs/agent-audit/REVIEW-ACCURACY-2026-10-25.md.) A measurement, not a gate: nothing here
 * asserts a budget, so it cannot go red on a slow day. It goes red only when its own instrument is
 * broken (a control fails) or the tile never appears (UNMEASURED, not a slow number).
 *
 * Opt-in (HOME_FIRST_VIEW=1) so the live canary job, which runs every spec, skips it. Runs against the
 * LOCAL `vite build` served from 127.0.0.1 by a tiny in-process server (no database, no production):
 * throttling needs real sockets, so this is not the page.route approach the admin fixtures use.
 * Every /api/ call is answered 404 and listed; every third-party host (fonts, pixels) is refused and
 * listed. A page measured this way has no live reviews, specials or weather, so the review toast and
 * any data-gated tile can differ from production: read the numbers as the shell's cost, not the live page's.
 *
 * Throttle: the repo has no throttled-4G fixture (grep 2026-10-25), so this defines the PageSpeed/Lighthouse
 * mobile profile: 150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up, 4x CPU slowdown, applied by the browser (DevTools
 * style), which is harsher than Lighthouse's simulated throttling. Text is gzipped as production's is. Run 1 is an
 * unthrottled reference. Read the numbers as a comparison of the first view against itself, not as a PageSpeed score.
 *
 * Run (from apps/nickstire, after `node node_modules/vite/bin/vite.js build`), phone project only:
 *   HOME_FIRST_VIEW=1 node node_modules/@playwright/test/cli.js test tests/e2e/home-first-view.spec.ts --project=iphone-se --workers=1
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

const DIST = path.resolve(process.env.ADMIN_V1_DIST ?? "dist/public");
const VIEWPORT = { width: 375, height: 812 };
const RUNS = 3;
const SCROLL_PX = 600;
const SETTLE_MS = 4000;
const PROFILE = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpu: 4 };
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
};

/** Page-side recorder: first time the tile exists, and first time it is on screen and effectively opaque. */
const INIT_SCRIPT = `(() => {
  const s = (window.__fv = { tileInDom: null, tileVisible: null, fcp: null, lcp: null, lcpSize: null, lcpUrl: null, lcpEl: null });
  const re = /get tires now/i;
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === "none" || c.visibility === "hidden") return 0; o *= parseFloat(c.opacity); } return o; };
  const tick = () => {
    const now = performance.now();
    const el = Array.from(document.querySelectorAll("a[aria-label]")).find((a) => re.test(a.getAttribute("aria-label") || ""));
    if (el) {
      if (s.tileInDom === null) s.tileInDom = now;
      const r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
      if (s.tileVisible === null && inView && eff(el) >= 0.95) s.tileVisible = now;
    }
    if (s.tileVisible === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") s.fcp = e.startTime; }).observe({ type: "paint", buffered: true }); } catch {}
  // The LCP entry names its element (null once that element left the DOM) and, for an image, its URL: record both, so the report says WHICH element was the largest paint.
  try { new PerformanceObserver((l) => { const e = l.getEntries(); if (!e.length) return; const x = e[e.length - 1]; s.lcp = x.startTime; s.lcpSize = x.size; s.lcpUrl = x.url || null; const el = x.element; s.lcpEl = el ? { tag: el.tagName.toLowerCase(), id: el.id || null, cls: String(el.className || "").slice(0, 80) || null, src: el.currentSrc || el.getAttribute("src") || null, text: (el.textContent || "").trim().slice(0, 40) || null } : null; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
})();`;

/** Page-side: share of the viewport whose topmost hit target sits inside a fixed or sticky layer. */
const MEASURE_FN = `(() => {
  const W = innerWidth, H = innerHeight, step = 6;
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === "none" || c.visibility === "hidden") return 0; o *= parseFloat(c.opacity); } return o; };
  const layerOf = (el) => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return n; } return null; };
  const layers = new Map(); let total = 0, covered = 0;
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
    total++;
    // Topmost element a tap lands on, skipping fully transparent ones (an opacity:0 overlay must not hide the bar beneath it).
    const hit = document.elementsFromPoint(x, y).find((e) => eff(e) >= 0.05); const l = hit && layerOf(hit);
    if (l) { covered++; layers.set(l, (layers.get(l) || 0) + 1); }
  }
  const out = [...layers].map(([el, n]) => { const r = el.getBoundingClientRect(); return { type: getComputedStyle(el).position, label: (el.getAttribute("aria-label") || el.id || el.tagName.toLowerCase() + "." + String(el.className).split(/\\s+/).slice(0, 3).join(".")).slice(0, 70), sharePct: +(100 * n / total).toFixed(1), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }).sort((a, b) => b.sharePct - a.sharePct);
  return { sharePct: +(100 * covered / total).toFixed(1), samples: total, layers: out };
})()`;

const CONTROL_FIXED = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:3000px">
<div id="solid" style="position:fixed;left:0;right:0;bottom:0;height:100px;background:#c0c"></div>
<div id="ghost-pe" style="position:fixed;inset:0;pointer-events:none;background:#00f"></div>
<div id="ghost-op" style="position:fixed;inset:0;opacity:0;background:#0f0"></div>`;
const controlTiming = (delayMs: number | null) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">
<a id="t" aria-label="Get tires now: control" href="#" style="display:block;margin:40px;padding:20px;opacity:0;transition:none">Get tires now</a>
${delayMs === null ? "" : `<script>setTimeout(function(){document.getElementById("t").style.opacity="1";window.__plantedAt=performance.now()},${delayMs})</script>`}`;

/** A small paint at once, a much larger one at 2500 ms: lcp must end up at the later time. */
const CONTROL_LCP = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">
<p style="font-size:12px">small</p>
<script>setTimeout(function(){var h=document.createElement("h1");h.style.cssText="font-size:64px;margin:0";h.textContent="A much larger heading that paints late";document.body.appendChild(h)},2500)</script>`;

let server: http.Server;
let origin = "";
const apiPaths = new Set<string>();

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    // Text is gzipped like production ("applies text compression" in the PageSpeed read); uncompressed, the same build costs about twice the transfer under this throttle.
    const send = (status: number, type: string, body: string | Buffer) => {
      const compress = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) && /^(text\/|application\/json|image\/svg)/.test(type);
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...(compress ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
      res.end(compress ? gzipSync(body) : body);
    };
    if (p === "/__control-fixed") return send(200, MIME[".html"], CONTROL_FIXED);
    if (p === "/__control-timing-2000") return send(200, MIME[".html"], controlTiming(2000));
    if (p === "/__control-lcp") return send(200, MIME[".html"], CONTROL_LCP);
    if (p === "/__control-timing-never") return send(200, MIME[".html"], controlTiming(null));
    if (p.startsWith("/api/")) { apiPaths.add(p.split("?")[0]); return send(404, "application/json", "{}"); }
    const file = path.join(DIST, decodeURIComponent(p));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return send(200, MIME[path.extname(file)] ?? "application/octet-stream", readFileSync(file));
    if (path.extname(p)) return send(404, "text/plain", "");
    return send(200, MIME[".html"], readFileSync(path.join(DIST, "index.html")));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

test.beforeEach(({}, info) => {
  test.skip(!process.env.HOME_FIRST_VIEW, "opt-in measurement: set HOME_FIRST_VIEW=1");
  test.skip(info.project.name !== "iphone-se", "phone measurement: run with --project=iphone-se (viewport is overridden to 375x812)");
  test.skip(!existsSync(path.join(DIST, "index.html")), `no SPA build at ${DIST}: run vite build first`);
});

test("home first view on a phone, throttled 4G", async ({}, info) => {
  test.setTimeout(300_000); // three throttled loads at 4x CPU plus the controls; the 45 s default would cut the third run
  // Own launch, not the `browser` fixture: HOME_FIRST_VIEW_CHANNEL=chrome (or msedge) uses the installed browser
  // when Playwright's bundled Chromium is not downloaded for this version. Unset = the bundled one.
  const browser = await chromium.launch({ channel: process.env.HOME_FIRST_VIEW_CHANNEL || undefined });
  try {
    await measure(browser, info);
  } finally {
    await browser.close();
  }
});

/** Wait out the settling window (late fixed layers mount, a later and larger paint can arrive), then read the recorder. */
type Recorder = Record<string, number | null> & { lcpUrl: string | null; lcpEl: { tag: string; id: string | null; cls: string | null; src: string | null; text: string | null } | null };
async function settle(page: Page): Promise<Recorder> {
  await page.waitForTimeout(SETTLE_MS);
  return page.evaluate(() => (window as unknown as { __fv: Recorder }).__fv);
}

async function measure(browser: Browser, info: TestInfo) {
  const blockedHosts = new Set<string>();
  const newPage = async (throttle: boolean) => {
    const context = await browser.newContext({
      viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: info.project.use.userAgent, serviceWorkers: "block",
      timezoneId: "America/New_York", locale: "en-US",
    });
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin === origin) return route.continue();
      blockedHosts.add(u.host);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.addInitScript(INIT_SCRIPT);
    if (throttle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: PROFILE.latency, downloadThroughput: PROFILE.downloadThroughput, uploadThroughput: PROFILE.uploadThroughput });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpu });
    }
    return { context, page };
  };

  // ---- controls first: prove the instrument reads a known answer before it reads the page ----
  const controls: Record<string, unknown> = {};
  {
    const { context, page } = await newPage(false);
    await page.goto(`${origin}/__control-timing-2000`);
    await page.waitForFunction(() => (window as unknown as { __fv: { tileVisible: number | null } }).__fv.tileVisible !== null, undefined, { timeout: 10_000 });
    const { t, planted } = await page.evaluate(() => ({ t: (window as unknown as { __fv: { tileVisible: number } }).__fv.tileVisible, planted: (window as unknown as { __plantedAt: number }).__plantedAt }));
    controls.timingPlanted = { plantedAtMs: Math.round(planted), readMs: Math.round(t) };
    // Against the page's own stamp, not a wall-clock 2000: a loaded machine fires the timer late (it fired at 6.6 s once), and that is not the recorder's error.
    expect(planted, "C1: the planted opacity change happened at or after 2000 ms").toBeGreaterThanOrEqual(2000);
    expect(t, "C1: the tile is not reported visible before it turned opaque").toBeGreaterThanOrEqual(planted - 1);
    expect(t - planted, "C1: the recorder notices the planted change within 1000 ms").toBeLessThan(1000);
    await context.close();
  }
  {
    const { context, page } = await newPage(false);
    await page.goto(`${origin}/__control-timing-never`);
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => (window as unknown as { __fv: { tileInDom: number | null; tileVisible: number | null } }).__fv);
    controls.timingNeverOpaque = s;
    expect(s.tileInDom, "C2: the transparent tile is in the DOM").not.toBeNull();
    expect(s.tileVisible, "C2: a tile that stays at opacity 0 is never reported visible").toBeNull();
    await context.close();
  }
  {
    const { context, page } = await newPage(false);
    await page.goto(`${origin}/__control-fixed`);
    const r = (await page.evaluate(MEASURE_FN)) as { sharePct: number; layers: { label: string }[] };
    controls.coverage = r;
    // 100 of 812 px is 12.3%; the 6 px sampling grid is good to about one point. The pointer-events:none and opacity:0 full-screen layers must add nothing.
    expect(r.sharePct, "C3: a planted 375x100 solid fixed bar reads 12.3% (+-1.5)").toBeGreaterThan(10.8);
    expect(r.sharePct, "C3: a planted 375x100 solid fixed bar reads 12.3% (+-1.5)").toBeLessThan(13.8);
    expect(r.layers.length, "C3: only the solid bar counts as a layer").toBe(1);
    await context.close();
  }
  {
    const { context, page } = await newPage(false);
    await page.goto(`${origin}/__control-lcp`);
    const s = await settle(page);
    controls.lcpPlantedLarger2500ms = s.lcp && Math.round(s.lcp);
    expect(s.lcp ?? 0, "C4: a larger paint planted at 2500 ms reaches lcp (read after the settle window)").toBeGreaterThanOrEqual(2400);
    controls.lcpPlantedElement = s.lcpEl;
    expect(s.lcpEl?.tag, "C4b: the recorder names the planted h1 as the LCP element").toBe("h1");
    await context.close();
  }

  // ---- the measurement ----
  const runs: Array<Record<string, unknown>> = [];
  // Run 1 is an UNTHROTTLED reference (what the machine alone costs); runs 2..RUNS+1 carry the 4G profile.
  const plan = [false, ...Array<boolean>(RUNS).fill(true)];
  for (let i = 1; i <= plan.length; i++) {
    const throttled = plan[i - 1];
    const { context, page } = await newPage(throttled);
    const requests: number[] = [];
    page.on("requestfinished", () => requests.push(1));
    await page.goto(`${origin}/`, { waitUntil: "commit" });
    await page.waitForFunction(() => (window as unknown as { __fv: { tileVisible: number | null } }).__fv?.tileVisible != null, undefined, { timeout: 40_000 });
    const lcpAtTile = await page.evaluate(() => (window as unknown as { __fv: { lcp: number | null } }).__fv.lcp);
    const fv = await settle(page); // timings are read AFTER the window: a later, larger paint must reach lcp
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({ path: `test-results/home-first-view-top-run${i}.png` });
    const before = (await page.evaluate(MEASURE_FN)) as { sharePct: number; layers: unknown[] };
    await page.evaluate((px) => window.scrollTo(0, px), SCROLL_PX);
    await page.waitForTimeout(1500);
    const scrollY = await page.evaluate(() => window.scrollY);
    const after = (await page.evaluate(MEASURE_FN)) as { sharePct: number; layers: unknown[] };
    await page.screenshot({ path: `test-results/home-first-view-scrolled-run${i}.png` });
    runs.push({ run: i, throttled, tileInDomMs: fv.tileInDom && Math.round(fv.tileInDom), tileVisibleMs: fv.tileVisible && Math.round(fv.tileVisible), fcpMs: fv.fcp && Math.round(fv.fcp), lcpMs: fv.lcp && Math.round(fv.lcp), lcpAtTileMs: lcpAtTile && Math.round(lcpAtTile), lcpElement: fv.lcpEl ?? "UNMEASURED: the LCP entry carries no element", lcpUrl: fv.lcpUrl ?? null, lcpSizePx: fv.lcpSize, requestsFinished: requests.length, scrollY, coverageAtTop: before, coverageAfterScroll: after });
    await context.close();
  }

  const report = { readAt: new Date().toISOString(), viewport: VIEWPORT, profile: PROFILE, scrollPx: SCROLL_PX, controls, runs, apiPathsAnswered404: [...apiPaths].sort(), blockedHosts: [...blockedHosts].sort() };
  writeFileSync("test-results/home-first-view.json", JSON.stringify(report, null, 2));
  console.log("HOME_FIRST_VIEW " + JSON.stringify(report));
  expect(runs.every((r) => typeof r.tileVisibleMs === "number"), "the tile became visible in every run").toBe(true);
}
