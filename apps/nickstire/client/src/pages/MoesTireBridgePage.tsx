/**
 * MoesTireBridgePage — legacy-brand bridge page for "Moe's Tire" search traffic.
 *
 * Why this page exists:
 * GSC shows ~200 impressions/yr on Moe's brand queries (moe's tire euclid,
 * moes tire, moe's tires, moe's tire euclid avenue, moes auto shop, etc.).
 * The address at 17625 Euclid Ave was previously associated with Moe's Tire
 * in Google's knowledge graph. Drivers searching for the old shop land
 * confused on Nick's. This page bridges the gap: claims the legacy traffic,
 * reframes as ownership transition, sells the new shop's strengths.
 *
 * Strategy: capture, convert, redirect intent toward today's services.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { MapPin, Star, Wrench } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/moes-tire-euclid",
  // Hero shows the actual Moe's Tire & Auto sign + 4 open service bays + priced tire stacks.
  // wave-181.x · upgraded to the literal-match photo · the GSC query "moe's tires euclid"
  // (242 clicks @ pos 4.5 over 90d) now lands on a hero that visually confirms the
  // location. The filename itself carries the keyword for image-search ranking.
  heroImage: "/photos/moes-tire-euclid-cleveland-ohio-service-bays.webp",
  title: "Moe's Tire is Now Nick's · 17625 Euclid Ave Cleveland",
  description: "Looking for Moe's Tire on Euclid Ave in Cleveland? Same corner, new chapter — we're now Nick's Tire & Auto. Same address, same neighborhood-trust ethos, expanded services, payment programs on the spot. 4.9★ across 1,700+ Google reviews. Walk-ins 7 days. (216) 862-0005",
  eyebrow: "MOE'S TIRE EUCLID — SAME CORNER, NEW CHAPTER",
  h1: "MOE'S TIRE EUCLID IS NOW NICK'S TIRE & AUTO",
  sub: "Same shop. Same address. Same corner of Euclid Ave you remembered, with possibly a fresh coat of paint. New ownership, sharper service, and a coffee maker that's still standing after all these years. If you trusted this spot for tires, brakes, or repair before — you're still in the right place. We carry the legacy and we earned the rating: 4.9★ across 1,700+ verified Google reviews. Walk in 7 days a week, no appointment needed, no awkward small talk required.",
  startingPrice: "Used tires from $25 · installed free",
  pricingTitle: "WHAT WE DO HERE NOW",
  pricingSub: "Same building, expanded services. Tires, brakes, oil, diagnostics, alignment — full-service auto repair on Euclid Ave.",
  tiers: [
    { name: "Used Tires", price: "$25+", sub: "installed free (mount, balance, valve stems)", use: "Need a tire today on a tight budget — same spot you remembered, better stock + free install" },
    { name: "New Tires", price: "Live quote", sub: "all major brands · free install · $10-down financing", use: "Ready for a fresh set — we'll quote your size live, no upsell, $10-down approved in 90 seconds", featured: true },
    { name: "Brakes / Oil / Repair", price: "Free estimate", sub: "written before any work · same-day on most jobs", use: "The shop expanded — we're full-service auto repair now, not tires only" },
  ],
  includedTitle: "WHAT CHANGED — AND WHAT DIDN'T",
  includedSub: "Why customers from the Moe's days still send their kids and neighbors here.",
  included: [
    "Same address — 17625 Euclid Ave, Cleveland OH 44112. Same corner you remembered.",
    "New ownership, but the shop floor still runs on neighborhood-trust, not corporate scripts.",
    "We expanded beyond tires — full-service auto repair: brakes, oil, diagnostics, alignment, A/C, exhaust, electrical.",
    "Used tires still on the rack — from $25 installed, every tire 4-point checked before it goes on a customer's car.",
    "$10-down payment programs added — Acima, Snap, Koalafi, American First. Soft pull only, no FICO ding.",
    "4.9★ across 1,700+ verified Google reviews — earned, not bought.",
    "Walk-ins welcome 7 days a week. Sunday hours 9 AM–4 PM. Free check, written quote, you don't pay until you say yes.",
    "We show you the problem on a lift before any work starts. You see the cost before we touch the car.",
  ],
  faqs: [
    { q: "Is Moe's Tire still open?", a: "The shop at 17625 Euclid Ave that customers knew as Moe's is now Nick's Tire & Auto. Same location, same building, new ownership. If you visited Moe's for tires or repair in the past, this is where you'd come now — we're the same corner, same neighborhood shop, with expanded services and $10-down financing added. (216) 862-0005." },
    { q: "What happened to Moe's Tire on Euclid Avenue?", a: "The location transitioned to new ownership and rebranded as Nick's Tire & Auto. We kept the focus on honest, fair-priced tire and auto service for Cleveland's east side — and added new services (brakes, oil, diagnostics, alignment) and payment programs ($10 down, no credit check) that Moe's didn't offer. Same address: 17625 Euclid Ave." },
    { q: "Do you still sell used tires like Moe's did?", a: "Yes — used tires are still core to what we do. Pricing starts at $25 installed (mount, balance, valve stems). The difference now: every used tire passes a 4-point check — tread depth, sidewall, DOT date, plug history — before it goes on a customer's car. We don't sell tires we wouldn't put on our own family's cars. Walk in or call your size to confirm stock: (216) 862-0005." },
    { q: "Is the address the same as Moe's Tire?", a: "Yes — 17625 Euclid Ave, Cleveland OH 44112. Same corner of Euclid Ave you remembered. Open 7 days: Mon–Sat 8 AM–6 PM, Sunday 9 AM–4 PM. Walk-ins welcome — no appointment needed." },
    { q: "Do you accept the same customers Moe's did?", a: "Absolutely. If you were a regular at Moe's, you'll be treated like one here. Many of our current regulars came over from the Moe's days. We respect that history — and we earned the 4.9★ / 1,700+ reviews by treating every customer the same way: honest diagnostics, written estimates before any work, no upsells. (216) 862-0005." },
    { q: "What services do you offer that Moe's didn't?", a: "Moe's was tire-focused. Nick's Tire & Auto is full-service: tires (new + used + flat repair), brakes (pads, rotors, calipers, ABS), oil change (conventional + synthetic), diagnostics (check engine light, OBD-II), wheel alignment, A/C repair, transmission, electrical, battery, exhaust, emissions/E-Check. Plus $10-down financing on any service — no credit check, approved in 90 seconds, drive away today." },
    { q: "Are you open on Sunday like Moe's used to be?", a: "Yes — open 7 days. Sunday hours: 9 AM to 4 PM. Most repairs done same-day. Walk-ins welcome — most Sundays we have multiple bays free." },
    { q: "Can I get financing here?", a: "Yes — that's one of the biggest changes. $10 down, no credit check, approved in 90 seconds. We work with Acima, Snap, Koalafi, and American First. Most customers approved $500–$5,000. You drive away today, pay over time. No hard credit pull. Apply at the counter or online before you walk in." },
  ],
  bookingService: "tires",
  serviceType: "Tire & Auto Repair (formerly Moe's Tire location)",
  ctaHeadline: "SAME CORNER. NEW SHOP. STILL HERE FOR YOU.",
  ctaSub: "17625 Euclid Ave, Cleveland OH 44112. Walk in 7 days a week or call (216) 862-0005 for a live quote on tires, brakes, or repair.",

  fearStats: {
    heading: "Why drivers from the Moe's days come back.",
    stats: [
      {
        value: "4.9",
        unit: "★ Google rating",
        consequence: "Across 1,700+ verified reviews. Earned over years of honest work — not bought, not gamed. Real customers, real receipts.",
      },
      {
        value: "$10",
        unit: "down financing",
        consequence: "No credit check, approved in 90 seconds, 4 lenders. Drive away today, pay over time. Most customers approved $500–$5,000. Moe's didn't offer this.",
      },
      {
        value: "7",
        unit: "days a week",
        consequence: "Open Sunday 9–4, Mon–Sat 8–6. Walk-ins welcome. Most repairs done same day. The corner you trusted, hours that fit a real life.",
      },
    ],
  },
  crossSell: {
    heading: "What did you actually come for?",
    items: [
      {
        tone: "info",
        icon: <Wrench className="w-5 h-5" />,
        symptom: "Tires — like the old days",
        consequence: "Used from $25 installed, new tires with live quotes by size, every tire 4-point checked before install.",
        relief: "Walk in any day or call (216) 862-0005 to confirm your size in stock.",
        ctaLabel: "USED TIRES — FROM $25",
        ctaHref: "/used-tires-cleveland",
      },
      {
        tone: "warning",
        icon: <Star className="w-5 h-5" />,
        symptom: "Brakes, oil, diagnostics, repair",
        consequence: "Full-service auto repair on the same corner. Free written estimate before any wrench moves.",
        relief: "Most repairs done same day. $10-down financing, no credit check.",
        ctaLabel: "SEE ALL SERVICES",
        ctaHref: "/services",
      },
      {
        tone: "info",
        icon: <MapPin className="w-5 h-5" />,
        symptom: "Just need directions",
        consequence: "17625 Euclid Ave, Cleveland OH 44112. Same corner of Euclid Ave you remembered.",
        relief: "Walk-ins 7 days. Open Sunday 9 AM–4 PM.",
        ctaLabel: "GET DIRECTIONS",
        ctaHref: "/contact",
      },
    ],
  },
};

export default function MoesTireBridgePage() {
  return <FocusedServicePage config={CONFIG} />;
}
