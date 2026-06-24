import { storagePut } from "../../storage";
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";
import type { CarouselBrief, CarouselSlide } from "../../../client/src/lib/igCarouselStudio";
import {
  ANTON_TTF_B64, BARLOW_SEMI_TTF_B64, BARLOW_BOLD_TTF_B64, TIRE_HERO_JPG_B64, TREAD_MACRO_JPG_B64,
} from "../adStudio/adAssets";
import { esc, AD_INK, AD_YELLOW } from "../adStudio/adTemplate";

const log = createLogger("services:carouselStudio:render");

function fontFace(family: string, b64: string, weight: number): string {
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');font-weight:${weight};font-style:normal}`;
}

const FONT_CSS =
  fontFace("Anton", ANTON_TTF_B64, 400) +
  fontFace("BarlowC", BARLOW_SEMI_TTF_B64, 600) +
  fontFace("BarlowC", BARLOW_BOLD_TTF_B64, 700);

const HERO_URI = `data:image/jpeg;base64,${TIRE_HERO_JPG_B64}`;
const TREAD_URI = `data:image/jpeg;base64,${TREAD_MACRO_JPG_B64}`;

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden}
.stage{position:relative;width:1080px;height:1080px;background:${AD_INK};color:#F7F7F5;
  font-family:'BarlowC','Arial Narrow',sans-serif;overflow:hidden}
.stage::before{content:'';position:absolute;inset:0;
  background:radial-gradient(120% 90% at 50% 16%, #1c1c1c 0%, ${AD_INK} 62%)}
.stage::after{content:'';position:absolute;inset:26px;border:3px solid ${AD_YELLOW}33;z-index:6}
.slash{position:absolute;right:-160px;top:0;width:420px;height:1080px;background:${AD_YELLOW};
  transform:skewX(-12deg);opacity:.10;z-index:1}
.pad{position:absolute;inset:0;padding:86px;display:flex;flex-direction:column;z-index:5}
.kicker{display:flex;align-items:center;gap:18px;font-weight:700;letter-spacing:6px;
  font-size:30px;color:${AD_YELLOW};text-transform:uppercase}
.kicker .mark{width:26px;height:26px;background:${AD_YELLOW};transform:skewX(-12deg)}
.yellow{color:${AD_YELLOW}}.muted{color:#A8A8A0}
.head{font-family:'Anton',Impact,sans-serif;text-transform:uppercase;line-height:1;letter-spacing:1px;text-shadow:0 6px 30px #000a}
.xl{font-size:160px}.lg{font-size:120px}.md{font-size:100px}
.sub{font-weight:700;font-size:52px;color:#EDEDE6;line-height:1.15;margin-top:40px}
.sub b{color:${AD_YELLOW}}
.body-text{font-weight:600;font-size:46px;color:#D4D4CE;line-height:1.25;margin-top:30px;white-space:pre-wrap;}
.spacer{flex:1}
.footer{font-weight:700;letter-spacing:3px;font-size:26px;color:#8a8a82;text-transform:uppercase}
.bleed{position:absolute;z-index:2}
.bg-img{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0}
.scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,${AD_INK}ee 0%,${AD_INK}88 38%,${AD_INK}ee 100%)}
.cta-bar{margin-top:46px;background:${AD_YELLOW};color:${AD_INK};font-weight:700;letter-spacing:3px;
  font-size:40px;text-transform:uppercase;padding:28px 34px;text-align:center;transform:skewX(-8deg)}
.cta-bar span{display:inline-block;transform:skewX(8deg)}
`;

const KICKER = `<div class="kicker"><span class="mark"></span>${esc(BUSINESS.name)} — ${esc(BUSINESS.address.neighborhood)}</div>`;
const HANDLE = "@nicks_tire_euclid";

function buildSlideBody(slide: CarouselSlide, brief: CarouselBrief): string {
  // Try to split headline if it's too long, to highlight some part in yellow
  // For a simple aesthetic, let's just make the first line/sentence yellow if possible, or just plain.
  let headHtml = esc(slide.headline);
  if (slide.slideNumber === 1 && headHtml.includes(" ")) {
      const parts = slide.headline.split(" ");
      const mid = Math.floor(parts.length / 2);
      headHtml = `<span class="yellow">${esc(parts.slice(0, mid).join(" "))}</span><br>${esc(parts.slice(mid).join(" "))}`;
  }

  const role = slide.role;
  const isHook = role === "pattern_interrupt";
  const isEnd = role === "saveable_recap";

  if (isHook) {
    return `
      <img class="bleed" src="${HERO_URI}" style="right:-90px;bottom:-70px;width:760px;opacity:.80">
      <div class="pad">${KICKER}<div class="spacer"></div>
        <div class="head xl">${headHtml}</div>
        <div class="sub">${esc(slide.body)}</div>
        <div class="spacer"></div>
        <div class="footer">${HANDLE} · nickstire.org (Swipe &rarr;)</div>
      </div>`;
  }

  if (isEnd) {
      return `
        <div class="bg-img" style="background-image:url('${TREAD_URI}')"></div><div class="scrim"></div>
        <div class="pad">${KICKER}<div class="spacer"></div>
          <div class="head lg">${headHtml}</div>
          <div class="body-text">${esc(slide.body)}</div>
          <div class="spacer"></div>
          <div class="cta-bar"><span>Walk In. 7 Days A Week.</span></div>
          <div class="footer" style="margin-top:30px;">nickstire.org · ${HANDLE}</div>
        </div>`;
  }

  // Middle slides
  return `
    <div class="pad">${KICKER}<div class="spacer"></div>
      <div class="head lg">${headHtml}</div>
      <div class="body-text">${esc(slide.body)}</div>
      <div class="spacer"></div>
      <div class="footer">Slide ${slide.slideNumber} of 5 · ${HANDLE}</div>
    </div>`;
}

export function buildCarouselSlideHtml(slide: CarouselSlide, brief: CarouselBrief): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}${BASE_CSS}</style></head>` +
    `<body><div class="stage"><div class="slash"></div>${buildSlideBody(slide, brief)}</div></body></html>`;
}

/** Render + host the 5 slides of a Carousel Brief. Returns public URLs in running order. */
export async function renderCarouselBrief(brief: CarouselBrief): Promise<string[]> {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  
  const slideUrls: string[] = [];
  const stamp = Date.now();
  
  try {
    for (const slide of brief.slides) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
        await page.setContent(buildCarouselSlideHtml(slide, brief), { waitUntil: "load", timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        const buf = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
        
        const path = `carousel-studio/${stamp}-${brief.id}-slide${slide.slideNumber}.jpg`;
        const { url } = await storagePut(path, Buffer.from(buf), "image/jpeg");
        slideUrls.push(url);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  
  log.info("rendered organic carousel", { briefId: brief.id, slides: slideUrls.length });
  return slideUrls;
}
