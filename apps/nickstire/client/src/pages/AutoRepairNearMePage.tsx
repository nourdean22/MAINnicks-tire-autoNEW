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
import { Disc, Activity, Wrench, AlertTriangle } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/auto-repair-near-me",
  // wave-181.x · upgraded to mechanic-actively-working-on-a-customer-car shot.
  // GSC query "auto repair near me" wants visual proof of an actual working
  // shop · this photo shows a mechanic under the hood of a blue Kia with the
  // "Mechanic on Duty" sign visible · directly answers the query intent.
  // Filename carries "auto-mechanic-tire-shop-cleveland-ohio" for image-search.
  heroImage: "/photos/auto-mechanic-tire-shop-cleveland-ohio.webp",
  // 2026-05-06 copy wave: title now anchors on "Estimate Before
  // Wrench" — the actual differentiator. Sub rewritten with operator
  // 3 (useful absurd: "phone bill that never breaks") + operator 4
  // (anti-pattern: chains' diagnostic fee).
  title: "Auto Repair Near Me Cleveland · Free Check · No Pay Til Yes | Nick's",
  description: "Cleveland auto shop. Free check. Written quote. You don't pay until you say yes. Brakes, tires, oil, alignment, AC. Walk in 7 days. 4.9★ from 1,700+ drivers.",
  eyebrow: "LOCAL AUTO REPAIR",
  h1: "AUTO REPAIR THAT EXPLAINS ITSELF\nBEFORE IT BILLS YOU.",
  sub: "Cleveland mechanic near me. Walk in to Nick's on Euclid Ave with a noise, a light, or a bad feeling about something — we put it on a lift, take pictures of what's worn, and hand you a written quote before any wrench touches a bolt. The chains call that 'a $99 check-out fee.' We call it Tuesday. Free check. Written quote. You don't pay until you say yes. 4.9★ from 1,700+ Cleveland drivers, walk-ins 7 days, every make and model including the European stuff your buddy said you have to drive to the dealer for.",
  startingPrice: "Free estimates",
  pricingTitle: "COMMON REPAIR LEVELS",
  pricingSub: "Free written estimate before any work. Labor comparable to local shops, lower than dealers. Parts at fair markup — no games.",
  tiers: [
    { name: "Basic Maintenance", price: "Free estimate", sub: "oil, tire rotation, fluid flush", use: "Regular service to keep your car healthy and reliable" },
    { name: "Common Repairs", price: "Free estimate", sub: "brakes, starter, alternator, sensors", use: "Typical fix-it-today repairs done same day, 12-month warranty", featured: true },
    { name: "Major Repair", price: "Free estimate", sub: "timing chains, suspension, exhaust", use: "Bigger jobs with full transparency — written estimate before any work" },
  ],
  includedTitle: "WHY NEIGHBORS CHOOSE NICK'S",
  includedSub: "Local shop, honest pricing, real warranty. Not a corporate chain.",
  included: [
    "Free written estimate before any work begins",
    "Pictures of worn parts before replacement (no 'trust me' nonsense)",
    "OE-spec parts — OEM or name-brand aftermarket",
    "12-month parts / 90-day labor warranty",
    "Walk-ins welcome 7 days a week — most repairs same or next day",
    "$10 down financing via Snap, Acima, Koalafi",
    "Free multi-point check with every oil change",
    "30+ years of experience on domestic, Asian, and European vehicles",
  ],
  faqs: [
    { q: "Do you work on my type of car?", a: "Almost certainly yes. Domestic (Ford, Chevy, Dodge, GMC, Jeep), Asian (Toyota, Honda, Nissan, Hyundai, Kia, Mazda, Subaru, Lexus, Acura), European (BMW, Mercedes, Audi, VW, Volvo), trucks and SUVs. If we can't work on something specific, we'll tell you up front and refer you to someone who can." },
    { q: "How much is a full diagnostic?", a: "Free code scan on the spot. If it needs deeper checking — live data, component testing, wiring — we write you a quote first. If you fix it with us, the check fee comes off the bill. Free check. Written quote. You don't pay until you say yes." },
    { q: "Can I get an estimate before you start?", a: "Always. Every repair over $100 gets a written quote — we don't touch anything else until you say yes. If we find something additional while working, we stop and call you with the new number. We tell you the cost before we touch anything." },
    { q: "Do you offer financing?", a: "Yes — $10 down financing through Snap Finance, Acima, and Koalafi. Pre-approval takes 2 minutes with no hard credit check. Most customers qualify for $500-$5,000. Payments as low as $89/mo. Great if you need a repair today but the money's tight until next paycheck." },
    { q: "How long will my repair take?", a: "Depends on the job. Basic stuff (oil change, tire, brake pads): 30-90 minutes. Medium repairs (alternator, water pump, brakes + rotors): 2-4 hours. Major work (timing chain, transmission): 1-3 days. We give you an estimated completion time up front and text updates." },
    { q: "Do I need to make an appointment?", a: "Not usually. Walk-ins welcome 7 days a week. If you're dropping off, show up before 10 AM for best chance of same-day turnaround. Call ahead at (216) 862-0005 if it's a specific repair — that way we can confirm parts availability." },
    { q: "What's your warranty?", a: "12-month parts / 90-day labor for most repairs. If a part fails early or the fix didn't take, bring it back — we do it again for free. Real warranty, not 'good luck getting someone to honor it' corporate stuff." },
    { q: "Will you beat a dealer price?", a: "On most jobs, yes — dealers run $180-$220/hr labor plus OEM-only parts. Independent shops like ours run lower labor rates and use OEM or OE-spec aftermarket parts. The honest answer: bring your dealer quote in, we'll give you a free written quote side-by-side. Same brand pads and rotors, same warranty, lower bill — but you decide after seeing the numbers, not before." },
  ],
  bookingService: "general-repair",
  serviceType: "Auto Repair",
  ctaHeadline: "BOOK A REPAIR OR GET AN ESTIMATE",
  ctaSub: "Walk in 7 days, or fill out below — we'll confirm by text. 17625 Euclid Ave, Cleveland OH.",

  // ─── CONVERSION ARCHITECTURE ──────────────────────────
  anchorTable: {
    serviceName: "Mid-tier auto repair (alternator replacement) — Cleveland market",
    rows: [
      { label: "Cleveland-area dealer", price: "$675" },
      { label: "National chain shop", price: "$485" },
      { label: "Nick's Tire & Auto", price: "Free estimate", ours: true },
    ],
    source: "Representative quote, alternator replacement on a typical Cleveland-fleet sedan. Independent-shop labor rate vs dealer; OE-spec parts. Your exact number comes from a free written quote after we look at the car.",
  },
  // fearStats removed 2026-07-16: the block cited "$1,400 average cascade
  // cost", "37% of breakdowns", and "5x" to AAA studies that do not verifiably
  // exist in that form. Same fabricated-fear pattern scrubbed from /financing
  // (PR #747). Do not re-add stats here without a real, linkable source.
  lossStats: [
    {
      amount: 12,
      unit: "per day",
      label: "of compounding wear from a known unaddressed issue",
      reason: "Whatever's broken now is wearing other things while you wait. A weak alternator overworks the battery; worn ball joints accelerate tire wear; a slipping belt cooks the water pump bearings. Every system is connected.",
      ctaHref: "#booking",
      ctaLabel: "GET AN ESTIMATE",
    },
  ],
  crossSell: {
    heading: "What kind of fix do you need? Pick the right entry point.",
    items: [
      {
        tone: "danger",
        icon: <Disc className="w-5 h-5" />,
        symptom: "Brakes squealing or grinding?",
        consequence: "Highest-priority safety system. Don't drive on metal-on-metal.",
        relief: "Free brake inspection + written estimate.",
        ctaLabel: "BRAKE REPAIR",
        ctaHref: "/brakes",
      },
      {
        tone: "warning",
        icon: <Activity className="w-5 h-5" />,
        symptom: "Check engine light on?",
        consequence: "Compounding damage if ignored. Cheaper to fix early.",
        relief: "Free 5-min code scan; deeper diagnostic gets a written estimate, credited if we fix it.",
        ctaLabel: "DIAGNOSTICS",
        ctaHref: "/diagnostics",
      },
      {
        tone: "info",
        icon: <Wrench className="w-5 h-5" />,
        symptom: "Just need maintenance?",
        consequence: "Skipping intervals causes the failures we're warning about above.",
        relief: "Free 27-point inspection on every oil change.",
        ctaLabel: "OIL CHANGE",
        ctaHref: "/oil-change",
      },
    ],
  },
};

export default function AutoRepairNearMePage() {
  return <FocusedServicePage config={CONFIG} />;
}
