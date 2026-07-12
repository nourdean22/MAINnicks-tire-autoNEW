/**
 * Hero personalization by traffic source (feat/home-v2 Wave C).
 *
 * The capture side has existed for months (lib/utm.ts persists UTM +
 * referrer + gclid into sessionStorage on first load); this is the thin
 * READ layer the audit called for: swap the hero's leading lane to match
 * the campaign the visitor clicked, and greet Maps arrivals with a
 * proximity line.
 *
 * Rules (deliberately conservative — a wrong guess costs more than no
 * personalization):
 *   - campaign/term/content mentions "brake"          → lead with brakes
 *   - campaign/term/content mentions "tire"/"tyre"    → lead with tires
 *     (the default — explicit so campaign traffic stays stable even if
 *     the default lead ever changes)
 *   - referrer is Google Maps                         → proximity note
 *
 * Constraints: pure function of the already-captured UtmData (no PII, no
 * fetches, deterministic → unit-testable); never invents stats or prices,
 * so the $25-band and anti-fabrication rules are untouched.
 */
import type { UtmData } from "@/lib/utm";

export type HeroLeadIntent = "tires" | "brakes";

export interface HeroPersonalization {
  /** Which lane leads the intent router (primary yellow tile). */
  leadIntent: HeroLeadIntent;
  /** True when the visitor arrived from Google Maps — show "you're close". */
  showProximityNote: boolean;
}

export const DEFAULT_HERO_PERSONALIZATION: HeroPersonalization = {
  leadIntent: "tires",
  showProximityNote: false,
};

export function deriveHeroPersonalization(
  utm: Pick<UtmData, "utmCampaign" | "utmTerm" | "utmContent" | "referrer">,
): HeroPersonalization {
  const signal = [utm.utmCampaign, utm.utmTerm, utm.utmContent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let leadIntent: HeroLeadIntent = "tires";
  // Order matters: an explicit tire signal wins over an incidental brake
  // mention (e.g. campaign "tires-and-brakes-promo" should lead tires —
  // tires is the entry-starved funnel we route to by default).
  if (/tire|tyre/.test(signal)) {
    leadIntent = "tires";
  } else if (/brake/.test(signal)) {
    leadIntent = "brakes";
  }

  let showProximityNote = false;
  if (utm.referrer) {
    try {
      const host = new URL(utm.referrer).hostname.toLowerCase();
      showProximityNote =
        host === "maps.app.goo.gl" ||
        host.startsWith("maps.google") ||
        (host.includes("google") && new URL(utm.referrer).pathname.startsWith("/maps"));
    } catch {
      showProximityNote = false;
    }
  }

  return { leadIntent, showProximityNote };
}
