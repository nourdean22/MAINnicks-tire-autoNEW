/**
 * WIN-BACK SMS TEMPLATES — brand-aligned per cohort tier.
 *
 * v7 · BATCH 4 · Apr 28. For each customer in the win-back cohort
 * (90-180d silent), generate an SMS draft tuned to:
 *   · their last service (so we say "your alignment is probably due"
 *     not "we miss you")
 *   · time silent (different tone at 90d vs 150d)
 *   · LTV tier (whales get warm + premium offer; regulars get value)
 *
 * No marketing-speak. Brand voice rules from brand_rules.md:
 *   · Confident mechanic, not marketer
 *   · Short sentences, line breaks
 *   · Specific service > generic "miss you"
 *   · CTA: "Stop by" / "Call (216) 631-5870" / "Pull up" — never
 *     "click here" / "tap to redeem"
 *
 * Output: SMS-ready text, max 160 chars (one SMS), or 320 (two SMS).
 */

interface CustomerInput {
  initial: string;
  vehicle: string;
  daysSinceLastVisit: number;
  lifetimeRevenue: number;
  lastServices: string[]; // most-recent visit's service list
  visits: number;
}

export interface WinBackDraft {
  smsText: string;
  charCount: number;
  smsCount: 1 | 2;
  tier: "whale" | "regular" | "occasional";
  hookType: "service_due" | "appreciation" | "value_offer";
}

const TIER_THRESHOLDS = {
  whale: 1500,    // $1500+ LTV
  regular: 500,   // $500-$1499 LTV
  // occasional: <$500
};

function tierForLtv(ltv: number): WinBackDraft["tier"] {
  if (ltv >= TIER_THRESHOLDS.whale) return "whale";
  if (ltv >= TIER_THRESHOLDS.regular) return "regular";
  return "occasional";
}

// Service-specific reminder lines — short, accurate, no fluff
const SERVICE_REMINDERS: Record<string, string> = {
  "oil change": "Oil's probably due",
  "tire rotation": "Tires due for rotation",
  brakes: "Brakes worth a check",
  alignment: "Alignment likely needs a look",
  battery: "Battery age is getting up there",
  "transmission service": "Trans fluid due for service",
  "spark plug": "Plugs due",
  "tune-up": "Tune-up time",
  inspection: "Time for an inspection",
  diagnostics: "Quick diag check",
};

function pickServiceReminder(services: string[]): string {
  for (const s of services) {
    const t = s.toLowerCase();
    for (const [key, line] of Object.entries(SERVICE_REMINDERS)) {
      if (t.includes(key)) return line;
    }
  }
  return "Time for a check-up";
}

export function generateWinBackSms(c: CustomerInput): WinBackDraft {
  const tier = tierForLtv(c.lifetimeRevenue);
  const reminder = pickServiceReminder(c.lastServices);
  const months = Math.round(c.daysSinceLastVisit / 30);

  let smsText: string;
  let hookType: WinBackDraft["hookType"];

  if (tier === "whale") {
    // Whales get warmth + slot priority — no discount, just signal value
    hookType = c.daysSinceLastVisit < 120 ? "service_due" : "appreciation";
    if (hookType === "service_due") {
      smsText = `${c.initial}, ${reminder} on the ${c.vehicle}. Want me to slot you in this week? — Nick's Tire (216) 631-5870`;
    } else {
      smsText = `${c.initial}, been a minute. ${reminder} on the ${c.vehicle}. Pull up when you're ready — your bay's open. Nick's Tire (216) 631-5870`;
    }
  } else if (tier === "regular") {
    // Regulars get specific service mention + clear ask
    hookType = "service_due";
    smsText = `${c.initial}, ${reminder} on the ${c.vehicle} (about ${months}mo since last visit). Stop by or call (216) 631-5870 — Nick's Tire`;
  } else {
    // Occasional — value offer to re-establish the relationship
    hookType = "value_offer";
    smsText = `${c.initial} — ${reminder} on the ${c.vehicle}? We can have you in/out same day. (216) 631-5870 — Nick's Tire`;
  }

  // Force max length — if over 160 split into 2 messages, but try to
  // keep under 160 first
  if (smsText.length > 320) {
    smsText = smsText.slice(0, 318) + "…";
  }

  return {
    smsText,
    charCount: smsText.length,
    smsCount: smsText.length > 160 ? 2 : 1,
    tier,
    hookType,
  };
}
