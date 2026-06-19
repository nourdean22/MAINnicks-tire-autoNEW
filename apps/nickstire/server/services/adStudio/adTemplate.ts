/**
 * Ad Studio — pure HTML/CSS slide template (graphic design, NO fake people).
 *
 * Renders the operator-approved "garage poster" carousel ad: Nick's yellow
 * (#FDB913) on near-black, Anton display type, real product object shots as
 * accents, and a designed review card (real BUSINESS numbers — never LLM).
 *
 * This module is PURE: it turns a normalized slide model into an HTML string.
 * Fonts + product image are injected as data-URIs by the caller (adRender) so
 * the render is deterministic and offline (no Google-Fonts fetch at runtime).
 * No puppeteer / network / IO here — keeps it unit-testable.
 */
import { BUSINESS } from "@shared/business";

export const AD_INK = "#0A0A0A";
export const AD_YELLOW = "#FDB913";

export type AdSlideRole = "hook" | "value" | "offer" | "proof" | "cta";

/** Copy the LLM produces (persuasive slides only — proof/cta come from BUSINESS). */
export interface AdCopy {
  /** hook card */
  hookYellow: string; // e.g. "$10 DOWN."
  hookWhite: string; //  e.g. "DRIVE TODAY."
  hookSub: string; //    e.g. "New tires from $89 installed · no credit check"
  /** value card */
  valueWhite: string; // e.g. "NO CREDIT CHECK."
  valueYellow: string; // e.g. "$10 DOWN."
  valueTicks: [string, string, string];
  /** offer / free-check card */
  offerYellow: string; // e.g. "FREE"
  offerWhite: string; //  e.g. "TIRE CHECK."
  offerSub: string;
  /** the IG caption */
  caption: string;
}

export interface RenderSlide {
  role: AdSlideRole;
  fontCss: string; //         @font-face block (base64 data-URIs)
  heroImg?: string; //        data-URI product shot (hook/offer accent)
  treadImg?: string; //       data-URI product shot (offer bg)
  copy: AdCopy;
}

/** Escape a user/LLM string for safe insertion into HTML text (defense-in-depth). */
export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
.head{font-family:'Anton',Impact,sans-serif;text-transform:uppercase;line-height:.9;letter-spacing:1px;text-shadow:0 6px 30px #000a}
.xl{font-size:184px}.lg{font-size:140px}
.sub{font-weight:700;font-size:52px;color:#EDEDE6;line-height:1.08;margin-top:30px}
.sub b{color:${AD_YELLOW}}
.spacer{flex:1}
.footer{font-weight:700;letter-spacing:3px;font-size:26px;color:#8a8a82;text-transform:uppercase}
.bleed{position:absolute;z-index:2}
.bg-img{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0}
.scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,${AD_INK}ee 0%,${AD_INK}88 38%,${AD_INK}ee 100%)}
.ticks{list-style:none;margin-top:44px;display:flex;flex-direction:column;gap:30px}
.ticks li{display:flex;align-items:center;gap:24px;font-size:50px;font-weight:700;color:#EDEDE6}
.ticks li .dot{width:46px;height:46px;flex:0 0 46px;border-radius:50%;background:${AD_YELLOW};
  display:flex;align-items:center;justify-content:center;color:${AD_INK};font-size:34px;font-weight:700;line-height:1}
.ticks li b{color:${AD_YELLOW}}
.center{align-items:center;text-align:center;justify-content:center}
.stars{font-size:96px;color:${AD_YELLOW};letter-spacing:12px}
.rating{font-family:'Anton',Impact,sans-serif;font-size:300px;line-height:.86;color:#fff}
.chips{display:flex;gap:18px;margin-top:44px;justify-content:center}
.chips span{border:2px solid ${AD_YELLOW}66;color:${AD_YELLOW};font-weight:700;letter-spacing:2px;
  font-size:30px;padding:14px 26px;border-radius:999px;text-transform:uppercase}
.info{margin-top:46px;display:flex;flex-direction:column;gap:30px}
.info .row{display:flex;align-items:center;gap:24px;font-size:48px;font-weight:700;color:#EDEDE6}
.info .ic{width:54px;height:54px;flex:0 0 54px;background:${AD_YELLOW};color:${AD_INK};border-radius:12px;
  display:flex;align-items:center;justify-content:center;font-size:30px}
.cta-bar{margin-top:46px;background:${AD_YELLOW};color:${AD_INK};font-weight:700;letter-spacing:3px;
  font-size:40px;text-transform:uppercase;padding:28px 34px;text-align:center;transform:skewX(-8deg)}
.cta-bar span{display:inline-block;transform:skewX(8deg)}
`;

const KICKER = `<div class="kicker"><span class="mark"></span>${esc(BUSINESS.name)} — ${esc(BUSINESS.address.neighborhood)}</div>`;
const HANDLE = "@nicks_tire_euclid";

function bodyForRole(s: RenderSlide): string {
  const c = s.copy;
  switch (s.role) {
    case "hook":
      return `${s.heroImg ? `<img class="bleed" src="${s.heroImg}" style="right:-90px;bottom:-70px;width:760px;opacity:.92">` : ""}
        <div class="pad">${KICKER}<div class="spacer"></div>
          <div class="head xl"><span class="yellow">${esc(c.hookYellow)}</span><br>${esc(c.hookWhite)}</div>
          <div class="sub">${esc(c.hookSub)}</div>
          <div class="spacer"></div><div class="footer">${HANDLE} · nickstire.org</div></div>`;
    case "value":
      return `<div class="pad">${KICKER}<div class="spacer"></div>
          <div class="head lg">${esc(c.valueWhite)}<br><span class="yellow">${esc(c.valueYellow)}</span></div>
          <ul class="ticks">${c.valueTicks.map((t) => `<li><span class="dot">&#10003;</span>${esc(t)}</li>`).join("")}</ul>
          <div class="spacer"></div><div class="footer">${HANDLE} · ${esc(BUSINESS.phone.display)}</div></div>`;
    case "offer":
      return `${s.treadImg ? `<div class="bg-img" style="background-image:url('${s.treadImg}')"></div><div class="scrim"></div>` : ""}
        <div class="pad">${KICKER}<div class="spacer"></div>
          <div class="head lg"><span class="yellow">${esc(c.offerYellow)}</span><br>${esc(c.offerWhite)}</div>
          <div class="sub">${esc(c.offerSub)}</div>
          <div class="spacer"></div><div class="footer">Walk in 7 days a week</div></div>`;
    case "proof": {
      const r = BUSINESS.reviews;
      return `<div class="pad center" style="padding-top:120px;padding-bottom:120px">${KICKER}<div class="spacer"></div>
          <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <div class="rating">${esc(String(r.rating))}</div>
          <div class="sub">on <b>${esc(r.countDisplay)}</b> Google reviews</div>
          <div class="sub muted" style="font-size:40px;margin-top:18px">${esc(BUSINESS.tagline)}</div>
          <div class="chips"><span>${esc(BUSINESS.founded.display)}</span><span>${esc(BUSINESS.ase.short)}</span><span>${esc(BUSINESS.languageDisplay.replace(/^Bilingual\s*\(/, "").replace(/\)$/, ""))}</span></div>
          <div class="spacer"></div><div class="footer">${HANDLE}</div></div>`;
    }
    case "cta":
      return `<div class="pad">${KICKER}<div class="spacer"></div>
          <div class="head lg">WALK IN.<br><span class="yellow">7 DAYS A WEEK.</span></div>
          <div class="info">
            <div class="row"><span class="ic">&#9679;</span>${esc(BUSINESS.address.full)}</div>
            <div class="row"><span class="ic">&#9742;</span>${esc(BUSINESS.phone.display)}</div>
            <div class="row"><span class="ic">&#9719;</span>${esc(BUSINESS.hours.fullDisplay)}</div>
          </div>
          <div class="cta-bar"><span>No appointment — first come, first serve</span></div>
          <div class="spacer"></div><div class="footer">nickstire.org · ${HANDLE}</div></div>`;
  }
}

/** Build a complete 1080x1080 HTML document for one ad slide. */
export function buildSlideHtml(slide: RenderSlide): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${slide.fontCss}${BASE_CSS}</style></head>` +
    `<body><div class="stage"><div class="slash"></div>${bodyForRole(slide)}</div></body></html>`;
}

/** The fixed 5-slide running order. */
export const AD_SLIDE_ORDER: AdSlideRole[] = ["hook", "value", "offer", "proof", "cta"];
