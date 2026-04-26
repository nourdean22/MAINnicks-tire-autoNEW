/**
 * AutoRepairNearMePage — targets "auto repair near me" + "mechanic
 * near me" queries. GSC (30d):
 *   "auto repair near me"   1,103 imps #24.5 — 0 clicks
 *   "mechanic near me"      1,012 imps #25.4 — 0 clicks
 *   "auto shop near me"     1,016 imps #27.1 — 0 clicks
 *   "auto repair"           1,002 imps #26.5 — 0 clicks
 *   "car repair"            1,089 imps #30.1 — 0 clicks
 *   "mechanic shops near me"  117 imps #13.1 — 0 clicks
 * Combined ~5,400 monthly impressions we could be capturing.
 * Replaces /general-repair as the canonical page for this intent.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/auto-repair-near-me",
  title: "Auto Repair Near Me — Cleveland's Local Mechanic | Nick's Tire & Auto",
  description: "Local auto repair shop in Cleveland/Euclid. Honest mechanics, 4.9★ on 1,700+ reviews, walk-ins 7 days. Brakes, tires, diagnostics, general repair. Free estimates. (216) 862-0005",
  eyebrow: "LOCAL AUTO REPAIR",
  h1: "AUTO REPAIR NEAR YOU — CLEVELAND",
  sub: "Looking for a mechanic near me in Cleveland? Nick's Tire & Auto at 17625 Euclid Ave, Cleveland is your neighborhood auto repair shop. Brakes, tires, diagnostics, engine, suspension, exhaust — we fix it. 4.9 stars from 1,700+ Google reviews, walk-ins 7 days a week.",
  startingPrice: "Free estimates",
  pricingTitle: "COMMON REPAIR PRICING",
  pricingSub: "Labor rates comparable to local shops, lower than dealerships. Parts at fair markup — no games.",
  tiers: [
    { name: "Basic Maintenance", price: "$39-$99", sub: "oil, tire rotation, fluid flush", use: "Regular service to keep your car healthy and reliable" },
    { name: "Common Repairs", price: "$150-$500", sub: "brakes, starter, alternator, sensors", use: "Typical fix-it-today repairs done same day, 12-month warranty", featured: true },
    { name: "Major Repair", price: "$600+", sub: "timing chains, suspension, exhaust", use: "Bigger jobs with full transparency — written estimate before any work" },
  ],
  includedTitle: "WHY NEIGHBORS CHOOSE NICK'S",
  includedSub: "Local shop, honest pricing, real warranty. Not a corporate chain.",
  included: [
    "Free written estimate before any work begins",
    "Pictures of worn parts before replacement (no 'trust me' nonsense)",
    "Quality parts — OEM or name-brand aftermarket",
    "12-month / 12,000-mile warranty on parts and labor",
    "Walk-ins welcome 7 days a week — most repairs same or next day",
    "$0 down financing via Snap, Acima, Koalafi",
    "Free multi-point inspection with every oil change",
    "30+ years of experience on domestic, Asian, and European vehicles",
  ],
  faqs: [
    { q: "Do you work on my type of car?", a: "Almost certainly yes. Domestic (Ford, Chevy, Dodge, GMC, Jeep), Asian (Toyota, Honda, Nissan, Hyundai, Kia, Mazda, Subaru, Lexus, Acura), European (BMW, Mercedes, Audi, VW, Volvo), trucks and SUVs. If we can't work on something specific, we'll tell you up front and refer you to someone who can." },
    { q: "How much is a full diagnostic?", a: "Free code scan on the spot. Full diagnostic (live data, component testing, wiring) is $95 and applies to the repair if you have us fix it. Complex electrical or intermittent issues quoted at $150/hr labor with a firm estimate up front — never open-ended." },
    { q: "Can I get an estimate before you start?", a: "Always. Every repair over $100 gets a written estimate — we don't touch anything else without your approval. If we find something additional while working, we stop and call you with the new number. No 'surprise' bills." },
    { q: "Do you offer financing?", a: "Yes — $0 down financing through Snap Finance, Acima, and Koalafi. Pre-approval takes 2 minutes with no hard credit check. Most customers qualify for $500-$5,000. Payments as low as $89/mo. Great if you need a repair today but the money's tight until next paycheck." },
    { q: "How long will my repair take?", a: "Depends on the job. Basic stuff (oil change, tire, brake pads): 30-90 minutes. Medium repairs (alternator, water pump, brakes + rotors): 2-4 hours. Major work (timing chain, transmission): 1-3 days. We give you an estimated completion time up front and text updates." },
    { q: "Do I need to make an appointment?", a: "Not usually. Walk-ins welcome 7 days a week. If you're dropping off, show up before 10 AM for best chance of same-day turnaround. Call ahead at (216) 862-0005 if it's a specific repair — that way we can confirm parts availability." },
    { q: "What's your warranty?", a: "12 months / 12,000 miles on parts and labor for most repairs. If a part fails early or the fix didn't take, bring it back — we do it again for free. Real warranty, not 'good luck getting someone to honor it' corporate stuff." },
    { q: "Will you beat a dealer price?", a: "On most jobs, yes — dealers charge $180-$220/hr labor plus OEM-only parts. We charge $120-$150/hr labor and use OEM or quality aftermarket parts. Typical dealer quote for brakes: $600-$800. Same job at Nick's: $329-$449 with the same quality pads and rotors." },
  ],
  bookingService: "general-repair",
  serviceType: "Auto Repair",
  ctaHeadline: "BOOK A REPAIR OR GET AN ESTIMATE",
  ctaSub: "Walk in 7 days, or fill out below — we'll confirm by text. 17625 Euclid Ave, Cleveland OH.",
};

export default function AutoRepairNearMePage() {
  return <FocusedServicePage config={CONFIG} />;
}
