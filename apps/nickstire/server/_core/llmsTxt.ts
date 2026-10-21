/**
 * /llms.txt body: structured guidance for AI answer engines (ChatGPT,
 * Perplexity, Gemini, Claude, Meta AI). Served by the handler in
 * server/_core/index.ts; a pure builder so the body can be tested without
 * booting the server (same shape as robots.ts).
 *
 * 2026-10-21 · every price is built from canon (shared/business.ts,
 * shared/pricing.ts) instead of hand-typed literals, so a price change reaches
 * the answer engines with no second edit. $89 is the site-wide new-tire FLOOR:
 * no line here prices a specific size. Hours, address, warranty and service
 * area are still literal text; canonical-business-truth.test.ts scans them.
 */
import { BUSINESS } from "../../shared/business";
import { PAYMENT_PROGRAMS_CREDIT_LINE, PAYMENT_PROGRAMS_SHORT } from "../../shared/financing";
import { BRAKE_PRICE, OIL_PRICE } from "../../shared/pricing";
import { TIRE_SIZE_PAGES } from "../../shared/tireSizes";

export function buildLlmsTxt(opts: { siteUrl: string; reviewRating: number | string; reviewCountDisplay: string }): string {
  const b = opts.siteUrl;
  const used = BUSINESS.usedTires;
  const newTires = BUSINESS.newTires;
  const phone = BUSINESS.phone.display;
  const sizeLinks = TIRE_SIZE_PAGES.map((p) => `- [${p.size}](${b}/tires/${p.slug})`).join("\n");
  return `# Nick's Tire & Auto
> Full-service auto repair and tire shop on Euclid Ave serving Cleveland, Euclid, and Northeast Ohio. Open 7 days, walk in (no appointment needed), written estimate before any work — you don't pay until you say yes.

## Key facts
- Address: 17625 Euclid Ave, Cleveland, OH 44112
- Phone: (216) 862-0005
- Hours: Monday-Saturday 8AM-6PM, Sunday 9AM-4PM (open 7 days a week)
- Rating: ${opts.reviewRating} stars from ${opts.reviewCountDisplay} Google reviews
- Warranty: 12-month parts / 90-day labor, in writing (no mileage cap)
- No appointment needed — first-come, first-served. Free drop-off with a ride back to work.
- ${PAYMENT_PROGRAMS_SHORT}. ${PAYMENT_PROGRAMS_CREDIT_LINE}
- Service area: Cleveland, Euclid, East Cleveland, South Euclid, Cleveland Heights, Shaker Heights, Garfield Heights, Lakewood, Parma, Mentor, Strongsville, Lyndhurst, Richmond Heights, Willoughby

## Services
- [Brake repair](${b}/brakes): Pads from $${BRAKE_PRICE.padsStarting}/axle; pads + rotors from $${BRAKE_PRICE.padsAndRotorsStarting}/axle, depending on vehicle. Free check and a written quote first.
- [Tires - new & used](${b}/tires): Used ${used.priceDisplay} (select 12-inch; ${used.typicalBand}), new ${newTires.priceDisplay}; the new-tire price depends on size and brand, so call or text ${phone} with your size for an exact quote. Free install package (mount, balance, valve stems, TPMS reset, alignment check).
- [Oil change](${b}/oil-change): Conventional from $${OIL_PRICE.conventional}, full synthetic from $${OIL_PRICE.fullSynthetic}. Free multi-point check included.
- [Engine diagnostics / check-engine light](${b}/diagnostics): Free code scan, honest diagnosis, written estimate first.
- [Ohio E-Check / emissions](${b}/emissions): Failed-emissions repair, O2 sensors, EVAP, catalytic converters. Free readiness check before the state test.
- [Wheel alignment](${b}/alignment): Stops uneven tire wear and pulling. Most vehicles same-day.
- [Auto repair (all services)](${b}/services): Brakes, tires, oil, diagnostics, alignment, emissions, suspension, batteries. All makes and models including European.
- [Payment programs](${b}/financing): five providers compared side by side; each provider decides approval.

## Tire sizes
New tires ${newTires.priceDisplay}; used tires in ${used.typicalBand}. Size pages:
${sizeLinks}

## Common questions
- Why is my car shaking or vibrating when I brake? Usually a warped brake rotor: the surface is no longer flat, so the pad grabs unevenly and you feel it in the wheel or pedal. Common on Cleveland cars from stop-and-go traffic and winter heat cycles. The fix is resurfacing or replacing the rotor, most often as a pads + rotors job. Free check at 17625 Euclid Ave, written quote before any work.
- Is it safe to drive with grinding brakes? No. Grinding means the pads are worn out and bare metal is cutting into the rotor, so every stop does more damage and your stopping distance gets longer. Get it checked the same day. Open 7 days, walk in or call (216) 862-0005.
- How much does a brake job cost in Cleveland? At Nick's Tire & Auto: pad replacement from $${BRAKE_PRICE.padsStarting} per axle. Rotors and other parts depend on what the free check finds; you get a written quote before any work, and you don't pay until you say yes.
- Where can I get brakes done near me in Cleveland (44112)? Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112 (east side), serving Euclid, East Cleveland, Cleveland Heights, South Euclid, and Lyndhurst. First-come-first-served, walk in 7 days a week, no appointment needed.
- Where can I get cheap 205/60R16 tires in Cleveland? Nick's Tire & Auto, ${BUSINESS.address.full}. New tires ${newTires.priceDisplay} and used tires in ${used.typicalBand}, with a free install package (mount, balance, valve stems, TPMS reset, alignment check). Walk in 7 days a week, no appointment needed, or call ${phone} to check the size on the rack first.

## Guides
- [Auto repair blog](${b}/blog): 120+ Cleveland-specific guides on brakes, tires, winter prep, repair costs, and common car problems.

## Contact
- Call or text (216) 862-0005 · 17625 Euclid Ave, Cleveland, OH 44112 · ${b}
`;
}
