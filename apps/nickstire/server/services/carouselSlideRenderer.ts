/**
 * Deterministic carousel slide renderer — the long-missing consumer of the
 * Carousel Studio's design intent.
 *
 * The 13-territory Carousel Studio has always produced HEADLINES, BODY COPY,
 * and a `textOverlayPlan` per slide — and no production path ever turned them
 * into finished slides (verified 2026-07-17: zero consumers). Studio V2's
 * renderer covers its OWN drafts with one universal 1080x1080 card, which is
 * exactly the "every post looks like the same ad" failure mode.
 *
 * This renderer produces native 4:5 (1080x1350) designed slides with OUR
 * typography (deterministic spelling, safe margins, page indicators, brand
 * system) and a per-territory design system so a blueprint deck does not look
 * like a luxury product ad. Same proven stack as Studio V2: inline-CSS HTML →
 * puppeteer (`renderHtmlToJpeg`) → `storagePut`.
 *
 * The prose `textOverlayPlan` is superseded by this deterministic layout —
 * the plan's INTENT (typography carries the teaching, never AI-baked text)
 * is what this module enforces.
 */
import { createLogger } from "../lib/logger";
import { fitFontSize } from "./instagramStudio";
import type { CarouselBrief, CarouselSlide, CreativeTerritory } from "../../client/src/lib/igCarouselStudio";

const log = createLogger("services:carousel-slide-renderer");

export const CAROUSEL_W = 1080;
export const CAROUSEL_H = 1350; // native IG 4:5 portrait

/** Minimal fields the renderer needs — callers may pass a full CarouselBrief. */
export type RenderableCarouselBrief = Pick<
  CarouselBrief,
  "creativeTerritory" | "campaignKeyword" | "topic"
> & { id?: string; slides: Array<Pick<CarouselSlide, "slideNumber" | "role" | "headline" | "body">> };

interface TerritoryDesign {
  /** page background (CSS) */
  bg: string;
  /** decorative motif layer (CSS for .motif) */
  motif: string;
  /** accent color for eyebrow/keyword/indicator */
  accent: string;
  /** headline color */
  ink: string;
  /** body color */
  body: string;
  /** eyebrow prefix shown before the brand name */
  badge: string;
}

/**
 * Per-territory design systems. Same philosophy as the reel/carousel prompt
 * compilers: premium gold-on-black is ONE style, not the default identity of
 * every deck.
 */
export const CAROUSEL_TERRITORY_DESIGNS: Record<CreativeTerritory, TerritoryDesign> = {
  cleveland_survival_guide: {
    bg: "linear-gradient(160deg,#1d2b23 0%,#0d1512 62%,#0a0f0c 100%)",
    motif: "background:repeating-linear-gradient(0deg,transparent 0 46px,rgba(214,196,151,.07) 46px 48px);",
    accent: "#d6c497", ink: "#f4efe2", body: "#c8c2b0", badge: "FIELD GUIDE",
  },
  mechanic_translation: {
    bg: "linear-gradient(180deg,#f4f2ec 0%,#e8e5dc 100%)",
    motif: "background:linear-gradient(90deg,transparent 49.7%,rgba(20,20,20,.16) 49.7% 50.3%,transparent 50.3%);",
    accent: "#b3452b", ink: "#171512", body: "#4a463e", badge: "PLAIN ENGLISH",
  },
  csi_evidence_board: {
    bg: "radial-gradient(circle at 30% 12%,#232527 0%,#101112 55%,#0a0b0c 100%)",
    motif: "background:repeating-linear-gradient(-35deg,transparent 0 180px,rgba(240,197,80,.10) 180px 196px);",
    accent: "#f0c550", ink: "#f2f2ef", body: "#b9bdc2", badge: "EVIDENCE",
  },
  myth_courtroom: {
    bg: "linear-gradient(170deg,#241a12 0%,#140e08 60%,#0b0705 100%)",
    motif: "background:radial-gradient(ellipse at 50% 0%,rgba(201,164,92,.16) 0%,transparent 55%);",
    accent: "#c9a45c", ink: "#f1e8d8", body: "#bdb09a", badge: "ON TRIAL",
  },
  tiny_world: {
    bg: "linear-gradient(165deg,#2a2118 0%,#171009 65%,#0f0a05 100%)",
    motif: "background:radial-gradient(circle at 78% 82%,rgba(255,178,72,.18) 0%,transparent 42%);",
    accent: "#ffb248", ink: "#fff3e3", body: "#d4c4ac", badge: "TINY WORLD",
  },
  warning_system: {
    bg: "radial-gradient(circle at 50% 100%,#1c1206 0%,#0d0a05 55%,#070604 100%)",
    motif: "background:radial-gradient(circle at 22% 20%,rgba(255,166,0,.22) 0 5px,transparent 6px),radial-gradient(circle at 80% 32%,rgba(255,72,48,.20) 0 5px,transparent 6px),radial-gradient(circle at 60% 14%,rgba(255,208,64,.18) 0 4px,transparent 5px);",
    accent: "#ffa600", ink: "#ffefd6", body: "#cdbfa4", badge: "EARLY WARNING",
  },
  luxury_part_hero: {
    bg: "radial-gradient(circle at 72% 20%,#2b2b2b 0%,#0d0d0d 52%,#050505 100%)",
    motif: "background:radial-gradient(ellipse at 50% 118%,rgba(253,185,19,.14) 0%,transparent 55%);",
    accent: "#FDB913", ink: "#ffffff", body: "#dcdcdc", badge: "FLAGSHIP",
  },
  road_villain: {
    bg: "linear-gradient(175deg,#20262e 0%,#11151b 58%,#0a0d11 100%)",
    motif: "background:repeating-linear-gradient(115deg,transparent 0 140px,rgba(122,158,198,.08) 140px 154px);",
    accent: "#7a9ec6", ink: "#e9eef5", body: "#aeb9c6", badge: "ROAD VILLAIN",
  },
  car_body_language: {
    bg: "linear-gradient(180deg,#1a1a1c 0%,#101012 65%,#0a0a0b 100%)",
    motif: "background:radial-gradient(ellipse at 18% 88%,rgba(140,220,190,.10) 0%,transparent 46%);",
    accent: "#8cdcbe", ink: "#eef4f1", body: "#b6c2bd", badge: "BODY LANGUAGE",
  },
  before_the_bill: {
    bg: "linear-gradient(105deg,#12211a 0 52%,#26120e 52% 100%)",
    motif: "background:linear-gradient(90deg,transparent 51.4%,rgba(255,255,255,.22) 51.4% 51.9%,transparent 51.9%);",
    accent: "#8fd0a0", ink: "#eef5ef", body: "#bfcabf", badge: "BEFORE THE BILL",
  },
  blueprint_xray: {
    bg: "linear-gradient(180deg,#0d2340 0%,#081729 65%,#050f1c 100%)",
    motif: "background:repeating-linear-gradient(0deg,transparent 0 53px,rgba(160,200,255,.10) 53px 54px),repeating-linear-gradient(90deg,transparent 0 53px,rgba(160,200,255,.10) 53px 54px);",
    accent: "#9cc8ff", ink: "#eaf3ff", body: "#b6c9e2", badge: "SCHEMATIC",
  },
  premium_product_ad: {
    bg: "radial-gradient(circle at 75% 18%,#292929 0%,#0b0b0b 46%,#050505 100%)",
    motif: "background:radial-gradient(ellipse at 50% 115%,rgba(253,185,19,.16) 0%,transparent 52%);",
    accent: "#FDB913", ink: "#ffffff", body: "#e2e2e2", badge: "PREMIUM",
  },
  weather_local_alert: {
    bg: "linear-gradient(180deg,#101820 0%,#0a1016 60%,#070b0f 100%)",
    motif: "background:linear-gradient(0deg,rgba(255,74,46,.14) 0 116px,transparent 116px),repeating-linear-gradient(90deg,transparent 0 220px,rgba(120,180,240,.08) 220px 232px);",
    accent: "#ff6a3d", ink: "#f2f6fa", body: "#bcc8d4", badge: "LOCAL ALERT",
  },
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pure HTML for one slide. Role-aware layout:
 *  - slide 1 (pattern interrupt): giant hook headline, no body competition;
 *  - slides 2-4: headline + teaching body;
 *  - final slide (saveable recap): headline + body + campaign-keyword CTA chip.
 * Safe margins ≥ 84px on all sides; typography sized by the shared
 * fitFontSize so long lines shrink instead of overflowing.
 */
export function renderCarouselSlideHtml(
  brief: RenderableCarouselBrief,
  slide: RenderableCarouselBrief["slides"][number],
  index: number,
  total: number,
): string {
  const design = CAROUSEL_TERRITORY_DESIGNS[brief.creativeTerritory] ?? CAROUSEL_TERRITORY_DESIGNS.premium_product_ad;
  const isHook = index === 0;
  const isFinal = index === total - 1;
  const pad = 84;
  const contentW = CAROUSEL_W - pad * 2;

  const headlineSize = fitFontSize(slide.headline, {
    width: Math.min(920, contentW), maxLines: isHook ? 3 : 2, max: isHook ? 132 : 96, min: 46, charRatio: 0.6,
  });
  const bodySize = fitFontSize(slide.body, {
    width: Math.min(880, contentW), maxLines: 6, max: 46, min: 26, charRatio: 0.52,
  });

  const dots = Array.from({ length: total }, (_, i) =>
    `<span class="dot${i === index ? " on" : ""}"></span>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${CAROUSEL_W}px;height:${CAROUSEL_H}px;overflow:hidden;background:#000}
body{font-family:Arial Black,Arial,sans-serif}
.stage{position:relative;width:100%;height:100%;padding:${pad}px;display:flex;flex-direction:column;background:${design.bg}}
.motif{position:absolute;inset:0;${design.motif}pointer-events:none}
.frame{position:absolute;inset:30px;border:2px solid ${design.accent}55;pointer-events:none}
.top{display:flex;justify-content:space-between;align-items:center;z-index:2}
.eyebrow{font:700 26px Arial,sans-serif;letter-spacing:5px;text-transform:uppercase;color:${design.accent}}
.count{font:700 25px Arial,sans-serif;color:${design.body};opacity:.8}
.main{margin:auto 0;z-index:2;max-width:94%}
.headline{font-size:${headlineSize}px;line-height:.92;letter-spacing:-3px;text-transform:uppercase;color:${design.ink};overflow-wrap:break-word;word-break:break-word;max-width:920px}
.body{margin-top:${isHook ? 0 : 34}px;font:700 ${bodySize}px/1.16 Arial,sans-serif;color:${design.body};max-width:880px;overflow-wrap:break-word;word-break:break-word;${isHook ? "display:none;" : ""}}
.kw{z-index:2;align-self:flex-start;margin-bottom:26px;background:${design.accent};color:#0a0a0a;padding:20px 28px;font:900 30px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;${isFinal ? "" : "display:none;"}}
.footer{z-index:2;display:flex;justify-content:space-between;align-items:center;font:700 23px Arial,sans-serif;letter-spacing:2px;color:${design.body};opacity:.85;text-transform:uppercase}
.dots{display:flex;gap:10px;align-items:center}
.dot{width:12px;height:12px;border-radius:50%;background:${design.body};opacity:.35;display:inline-block}
.dot.on{background:${design.accent};opacity:1;width:14px;height:14px}
</style></head><body><div class="stage"><div class="motif"></div><div class="frame"></div>
<div class="top"><div class="eyebrow">${esc(design.badge)} · NICK'S TIRE &amp; AUTO</div><div class="count">${index + 1}/${total}</div></div>
<div class="main"><div class="headline">${esc(slide.headline)}</div><div class="body">${esc(slide.body)}</div></div>
<div class="kw">SAVE THIS · DM &quot;${esc(brief.campaignKeyword)}&quot;</div>
<div class="footer"><span>@nicks_tire_euclid</span><div class="dots">${dots}</div><span>nickstire.org</span></div>
</div></body></html>`;
}

/**
 * Render every slide of a carousel brief to hosted 1080x1350 JPEGs.
 * Returns the hosted URLs in slide order. Throws on the first slide that
 * cannot render or host — a partial deck is not a deck.
 */
export async function renderCarouselSlides(brief: RenderableCarouselBrief): Promise<string[]> {
  const slides = [...brief.slides].sort((a, b) => a.slideNumber - b.slideNumber);
  if (!slides.length) throw new Error("carousel brief has no slides to render");
  const { renderHtmlToJpeg } = await import("./adStudio/adRender");
  const { storagePut } = await import("../storage");
  const deckId = brief.id || `carousel-${Date.now()}`;
  const urls: string[] = [];
  // Registry seam (tolerant — bookkeeping failure never fails the render)
  const registryDb = await import("../db").then((m) => m.getDb()).catch(() => null);
  const { registerProducedAsset } = await import("./mediaRegistry");
  for (let i = 0; i < slides.length; i++) {
    const html = renderCarouselSlideHtml(brief, slides[i], i, slides.length);
    const buffer = await renderHtmlToJpeg(html, CAROUSEL_W, CAROUSEL_H);
    const upload = await storagePut(`carousel-studio/${deckId}-${i + 1}.jpg`, buffer, "image/jpeg");
    if (!upload.url) throw new Error(`carousel slide ${i + 1} could not be hosted`);
    if (registryDb) {
      await registerProducedAsset(registryDb, buffer, {
        logicalKey: `carousel:${deckId}:slide:${i + 1}`,
        assetType: "carousel_slide",
        format: "image",
        mimeType: "image/jpeg",
        campaignId: deckId,
        provider: "deterministic-renderer",
        runtimeUrl: upload.url,
        generationParams: { territory: brief.creativeTerritory, slideNumber: i + 1, ofSlides: slides.length },
      });
    }
    urls.push(upload.url);
  }
  log.info("rendered carousel deck", { deckId, territory: brief.creativeTerritory, slides: urls.length });
  return urls;
}
