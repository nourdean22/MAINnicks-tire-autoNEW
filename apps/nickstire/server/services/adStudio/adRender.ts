/**
 * Ad Studio renderer — turns AdCopy into 5 hosted JPEG slide URLs.
 *
 * Pipeline: build each slide's HTML (adTemplate, fonts+images baked from
 * adAssets) -> puppeteer screenshot 1080x1080 JPEG -> storagePut (public URL
 * IG can fetch). Reuses the prod-proven puppeteer launch flags from
 * scripts/prerender.mjs. No new deps; deterministic; no external font fetch.
 */
import { existsSync } from "node:fs";
import { storagePut } from "../../storage";
import { createLogger } from "../../lib/logger";
import { buildSlideHtml, AD_SLIDE_ORDER, type AdCopy, type RenderSlide } from "./adTemplate";
import {
  ANTON_TTF_B64, BARLOW_SEMI_TTF_B64, BARLOW_BOLD_TTF_B64, TIRE_HERO_JPG_B64, TREAD_MACRO_JPG_B64,
} from "./adAssets";

const log = createLogger("services:adStudio:render");

function fontFace(family: string, b64: string, weight: number): string {
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');font-weight:${weight};font-style:normal}`;
}
const FONT_CSS =
  fontFace("Anton", ANTON_TTF_B64, 400) +
  fontFace("BarlowC", BARLOW_SEMI_TTF_B64, 600) +
  fontFace("BarlowC", BARLOW_BOLD_TTF_B64, 700);
const HERO_URI = `data:image/jpeg;base64,${TIRE_HERO_JPG_B64}`;
const TREAD_URI = `data:image/jpeg;base64,${TREAD_MACRO_JPG_B64}`;

/**
 * Typed "no headless Chrome on this box" outcome. Callers catch THIS (by class
 * or by `code`) and record it as an environment block instead of letting
 * puppeteer's generic "Could not find Chrome" escape as an unhandled 500.
 */
export class RendererUnavailableError extends Error {
  readonly code = "RENDERER_UNAVAILABLE" as const;
  constructor(readonly tried: string[]) {
    super(
      "Image renderer unavailable: no Chrome/Chromium executable on this server " +
        `(checked: ${tried.join(", ") || "nothing"}). ` +
        "Install chromium in the deploy image or set PUPPETEER_EXECUTABLE_PATH.",
    );
    this.name = "RendererUnavailableError";
  }
}

/** Where a distro package or a Chrome install lands on Linux (Debian/Ubuntu). */
export const SYSTEM_CHROME_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
] as const;

/**
 * Resolve a Chrome executable that EXISTS ON DISK, or throw
 * RendererUnavailableError.
 *
 * Production (NICKSTIRE-C, 2026-09-30) proved puppeteer's default lookup is not
 * enough: it only knows its own download cache (/root/.cache/puppeteer), and
 * that download never happens on Railway — pnpm 10 skips puppeteer's
 * postinstall ("Ignored build scripts: ... puppeteer"). An explicit env path,
 * the bundled cache, then the distro locations are tried in that order.
 */
export function resolveChromeExecutable(deps: {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  bundledPath?: () => string | undefined;
} = {}): string {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const candidates: string[] = [];
  for (const key of ["PUPPETEER_EXECUTABLE_PATH", "CHROME_PATH"] as const) {
    const value = env[key]?.trim();
    if (value) candidates.push(value);
  }
  try {
    const bundled = deps.bundledPath?.();
    if (bundled) candidates.push(bundled);
  } catch {
    /* puppeteer could not compute its cache path — fall through to the system paths */
  }
  candidates.push(...SYSTEM_CHROME_CANDIDATES);
  const found = candidates.find((p) => exists(p));
  if (!found) throw new RendererUnavailableError(candidates);
  return found;
}

/** One launch path for every renderer in this module. */
async function launchRenderBrowser() {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = resolveChromeExecutable({ bundledPath: () => puppeteer.executablePath() });
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
}

export interface RenderedAd {
  slideUrls: string[]; // 5 public JPEG URLs in running order
}

/** Render + host the 5 ad slides. Returns public URLs (hook,value,offer,proof,cta). */
export async function renderAdSlides(copy: AdCopy): Promise<RenderedAd> {
  const browser = await launchRenderBrowser();
  const slideUrls: string[] = [];
  const stamp = Date.now();
  try {
    for (const role of AD_SLIDE_ORDER) {
      const slide: RenderSlide = { role, fontCss: FONT_CSS, heroImg: HERO_URI, treadImg: TREAD_URI, copy };
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
        await page.setContent(buildSlideHtml(slide), { waitUntil: "load", timeout: 20000 });
        await page.evaluate(() => document.fonts.ready); // ensure Anton/Barlow are ready before shot
        const buf = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
        const { url } = await storagePut(`ad-studio/${stamp}-${role}.jpg`, Buffer.from(buf), "image/jpeg");
        slideUrls.push(url);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  log.info("rendered ad", { slides: slideUrls.length });
  return { slideUrls };
}

/**
 * Render a single branded HTML string to a JPEG buffer via headless Chrome.
 * Standalone (own browser) — for one-off posters, separate from the 5-slide
 * carousel path above. Same prod-proven puppeteer launch flags.
 */
export async function renderHtmlToJpeg(html: string, width = 1080, height = 1080): Promise<Buffer> {
  const browser = await launchRenderBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load", timeout: 20000 });
    await page.evaluate(() => document.fonts.ready); // Anton/Barlow ready before the shot
    const buf = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width, height } });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

/**
 * Render + host a single branded "garage poster" — reuses the operator-approved
 * hook-slide layout (Anton / #FDB913 / near-black, real product accent, NO fake
 * people). The Phase-6 branded image path for static autoposts. Public JPEG URL.
 */
export async function renderBrandedPoster(copy: AdCopy): Promise<string> {
  const slide: RenderSlide = { role: "hook", fontCss: FONT_CSS, heroImg: HERO_URI, treadImg: TREAD_URI, copy };
  const buf = await renderHtmlToJpeg(buildSlideHtml(slide));
  const { url } = await storagePut(`ad-studio/poster-${Date.now()}.jpg`, buf, "image/jpeg");
  log.info("rendered branded poster", { bytes: buf.length });
  return url;
}

