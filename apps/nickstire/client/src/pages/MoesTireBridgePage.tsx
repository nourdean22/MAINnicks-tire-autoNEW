/**
 * MoesTireBridgePage — legacy-brand bridge page for "Moe's Tire" search traffic.
 *
 * Why this page exists:
 * GSC shows ~200 impressions/yr on Moe's brand queries (moe's tire euclid,
 * moes tire, moe's tires, moe's tire euclid avenue, moes auto shop, etc.).
 * The address at 17625 Euclid Ave was previously associated with Moe's Tire
 * in Google's knowledge graph. Drivers searching for the old shop land
 * confused on Nick's. This page bridges the gap: claims the legacy traffic,
 * reframes as a name change under the same owner, sells the shop's strengths.
 *
 * Strategy: capture, convert, redirect intent toward today's services.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { useReviewStats } from "@/hooks/useReviewStats";
import {
  PAYMENT_PROGRAMS_CREDIT_LINE,
  PAYMENT_PROGRAMS_FAQ_ANSWER,
  PAYMENT_PROGRAMS_SHORT,
} from "@shared/financing";
import { MapPin, Star, Wrench } from "lucide-react";

// A FUNCTION, not a module constant: the rating and review count are live
// (useReviewStats), and a module-scope object is built once at import time —
// before any hook can run — so it could only ever carry the static floor.
const buildConfig = (reviewRating: string, reviewCountDisplay: string): ServicePageConfig => ({
  canonicalPath: "/moes-tire-euclid",
  // Hero shows the actual Moe's Tire & Auto sign + 4 open service bays + priced tire stacks.
  // wave-181.x · upgraded to the literal-match photo · the GSC query "moe's tires euclid"
  // (242 clicks @ pos 4.5 over 90d) now lands on a hero that visually confirms the
  // location. The filename itself carries the keyword for image-search ranking.
  heroImage: "/photos/moes-tire-euclid-cleveland-ohio-service-bays.webp",
  title: "Moe's Tire is Now Nick's · 17625 Euclid Ave Cleveland",
  description: `Looking for Moe's Tire on Euclid Ave? Same corner, now Nick's Tire & Auto: same address, more services, payment programs. ${reviewRating}★ across ${reviewCountDisplay} reviews.`,
  eyebrow: "MOE'S TIRE EUCLID — SAME CORNER, NEW CHAPTER",
  h1: "MOE'S TIRE EUCLID IS NOW NICK'S TIRE & AUTO",
  sub: `Same shop. Same address. Same corner of Euclid Ave you remembered, with possibly a fresh coat of paint. Same owner, sharper service, and a coffee maker that's still standing after all these years. If you came here for tires, brakes, or repair before — you're still in the right place. We carry the legacy and we earned the rating: ${reviewRating}★ across ${reviewCountDisplay} verified Google reviews. Walk in 7 days a week, no appointment needed, no awkward small talk required.`,
  startingPrice: "Used tires from $25 (select 12-inch; most $40-80) · installed free",
  pricingTitle: "WHAT WE DO HERE NOW",
  pricingSub: "Same building, expanded services. Tires, brakes, oil, diagnostics, alignment — full-service auto repair on Euclid Ave.",
  tiers: [
    { name: "Used Tires", price: "From $25", sub: "12-inch rims; most sizes $40-80 installed", use: "Need a tire today on a tight budget — same spot you remembered, better stock + free install" },
    { name: "New Tires", price: "Live quote", sub: "all major brands · free install · payment programs", use: "Ready for a fresh set — we'll quote your size live, no upsell, payment programs if you need them", featured: true },
    { name: "Brakes / Oil / Repair", price: "Free estimate", sub: "written before any work · same-day on most jobs", use: "The shop expanded — we're full-service auto repair now, not tires only" },
  ],
  includedTitle: "WHAT CHANGED — AND WHAT DIDN'T",
  includedSub: "Why customers from the Moe's days still send their kids and neighbors here.",
  included: [
    "Same address — 17625 Euclid Ave, Cleveland OH 44112. Same corner you remembered.",
    "Same owner — the shop floor still runs on neighborhood-trust, not corporate scripts.",
    "We expanded beyond tires — full-service auto repair: brakes, oil, diagnostics, alignment, A/C, exhaust, electrical.",
    "Used tires still on the rack — from $25 installed (12-inch rims; most sizes $40-80), every tire 4-point checked before it goes on a customer's car.",
    "Payment programs added — Acima, Snap Finance, Koalafi, American First Finance. Each provider decides approval.",
    `${reviewRating}★ across ${reviewCountDisplay} verified Google reviews — earned, not bought.`,
    "Walk-ins welcome 7 days a week. Sunday hours 9 AM–4 PM. Free check, written quote, you don't pay until you say yes.",
    "We show you the problem on a lift before any work starts. You see the cost before we touch the car.",
  ],
  faqs: [
    { q: "Is Moe's Tire still open?", a: "The shop at 17625 Euclid Ave that customers knew as Moe's is now Nick's Tire & Auto. Same location, same building, same owner — we simply changed the name from Moe's to Nick's. If you visited Moe's for tires or repair in the past, this is where you'd come now — same corner, same neighborhood shop, with expanded services and payment programs from four providers added. (216) 862-0005." },
    { q: "What happened to Moe's Tire on Euclid Avenue?", a: "The shop simply changed its name to Nick's Tire & Auto — same owner, same corner of Euclid Ave. We kept the focus on honest, fair-priced tire and auto service for Cleveland's east side, and over time added more services (brakes, oil, diagnostics, alignment) and payment programs from four providers the shop didn't offer in the earlier tire-only days. Same address: 17625 Euclid Ave." },
    { q: "Do you still sell used tires like Moe's did?", a: "Yes — used tires are still core to what we do. Pricing starts at $25 installed on 12-inch rims; most sizes run $40-80 installed, mount, balance and valve stems included. The difference now: every used tire passes a 4-point check — tread depth, sidewall, DOT date, plug history — before it goes on a customer's car. We don't sell tires we wouldn't put on our own family's cars. Walk in or call your size to confirm stock: (216) 862-0005." },
    { q: "Is the address the same as Moe's Tire?", a: "Yes — 17625 Euclid Ave, Cleveland OH 44112. Same corner of Euclid Ave you remembered. Open 7 days: Mon–Sat 8 AM–6 PM, Sunday 9 AM–4 PM. Walk-ins welcome — no appointment needed." },
    { q: "Do you accept the same customers Moe's did?", a: `Absolutely. If you were a regular at Moe's, you'll be treated like one here. Many of our current regulars came over from the Moe's days. We respect that history — and we earned the ${reviewRating}★ / ${reviewCountDisplay} reviews by treating every customer the same way: honest diagnostics, written estimates before any work, no upsells. (216) 862-0005.` },
    { q: "What services do you offer that Moe's didn't?", a: "Moe's was tire-focused. Nick's Tire & Auto is full-service: tires (new + used + flat repair), brakes (pads, rotors, calipers, ABS), oil change (conventional + synthetic), diagnostics (check engine light, OBD-II), wheel alignment, A/C repair, transmission, electrical, battery, exhaust, emissions/E-Check. Plus payment programs from four providers; the provider decides approval." },
    { q: "Are you open on Sunday like Moe's used to be?", a: "Yes — open 7 days. Sunday hours: 9 AM to 4 PM. Most repairs done same-day. Walk-ins welcome — most Sundays we have multiple bays free." },
    { q: "Can I get financing here?", a: PAYMENT_PROGRAMS_FAQ_ANSWER },
  ],
  bookingService: "tires",
  serviceType: "Tire & Auto Repair (formerly Moe's Tire location)",
  ctaHeadline: "SAME CORNER. NEW SHOP. STILL HERE FOR YOU.",
  ctaSub: "17625 Euclid Ave, Cleveland OH 44112. Walk in 7 days a week or call (216) 862-0005 for a live quote on tires, brakes, or repair.",

  fearStats: {
    heading: "Why drivers from the Moe's days come back.",
    stats: [
      {
        value: String(reviewRating),
        unit: "★ Google rating",
        consequence: `Across ${reviewCountDisplay} verified reviews. Earned over years of honest work — not bought, not gamed. Real customers, real receipts.`,
      },
      {
        value: "4",
        unit: "payment programs",
        consequence: `${PAYMENT_PROGRAMS_SHORT}. ${PAYMENT_PROGRAMS_CREDIT_LINE} Moe's didn't offer this.`,
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
        consequence: "Used from $25 installed (select 12-inch; most $40-80), new tires with live quotes by size, every tire 4-point checked before install.",
        relief: "Walk in any day or call (216) 862-0005 to confirm your size in stock.",
        ctaLabel: "USED TIRES — MOST SIZES $40-80",
        ctaHref: "/used-tires-cleveland",
      },
      {
        tone: "warning",
        icon: <Star className="w-5 h-5" />,
        symptom: "Brakes, oil, diagnostics, repair",
        consequence: "Full-service auto repair on the same corner. Free written estimate before any wrench moves.",
        relief: "Most repairs done same day. Payment programs available.",
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
});

export default function MoesTireBridgePage() {
  const { ratingDisplay: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();
  return <FocusedServicePage config={buildConfig(reviewRating, reviewCountDisplay)} />;
}
