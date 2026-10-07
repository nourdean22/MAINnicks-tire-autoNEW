/**
 * WheelAlignmentClevelandPage — targeted SEO landing for "wheel
 * alignment Cleveland" + "wheel alignment in cleveland ohio" + "wheel
 * alignment near me" cluster.
 *
 * wave-181.7 · per the Ahrefs/GSC audit (audit move #5, expected
 * +25-35 clicks/mo):
 *   - "wheel alignment cleveland" — 83 impr · pos 36.2 (page 4)
 *   - "wheel alignment in cleveland ohio" — pos 40.2 (page 4)
 *   - "alignment near me" — pos 7.1 (page 1, currently from /alignment)
 *
 * The current /alignment page ranks but isn't city-titled. This page
 * targets the city-aware variants with a tighter SEO footprint (title,
 * meta, H1 all lead with "Wheel Alignment Cleveland"). /alignment
 * remains for the generic-intent query — both pages co-exist and
 * cross-link.
 *
 * Strategy:
 *   - Hero anchors on city + same-day + free pull-check
 *   - Pricing tiers tied to alignment type (4-wheel vs 2-wheel vs
 *     post-collision)
 *   - Fear stats: cost of uneven tire wear + alignment compounding
 *   - FAQ schema · 8 alignment-specific questions
 *   - Cross-sell to /tires (alignment after new tires) + /tire-repair-cleveland
 *
 * Internal links: /alignment cross-links here, every city page should
 * link here as the "if your steering wheel pulls" funnel.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { useReviewStats } from "@/hooks/useReviewStats";
import { BUSINESS } from "@shared/business";
import { getRouteByPath } from "@shared/routes";
import { Car, Wrench, Activity } from "lucide-react";

// A FUNCTION, not a module constant: the rating and review count are live
// (useReviewStats), and a module-scope object is built once at import time —
// before any hook can run — so it could only ever carry the static floor.
const buildConfig = (reviewRating: string, reviewCountDisplay: string): ServicePageConfig => ({
  canonicalPath: "/wheel-alignment-cleveland",
  heroImage: "/photos/busy-shop-action-mechanics.webp",
  // 2026-10-07 · from the registry, not a literal: the literal here matched
  // AlignmentPage's exactly, so /alignment and this page shared one <title>.
  title: getRouteByPath("/wheel-alignment-cleveland")?.title ?? "",
  description: `Cleveland wheel alignment on Euclid Ave. Hunter rack, free pull-check first, written quote before any wrench moves. You don't pay until you say yes. ${reviewRating}★ from ${reviewCountDisplay} drivers.`,
  eyebrow: "WHEEL ALIGNMENT CLEVELAND · WALK-IN 7 DAYS",
  h1: "WHEEL ALIGNMENT CLEVELAND.\nFREE PULL-CHECK · YOU DON'T PAY UNTIL YOU SAY YES.",
  sub: "Car pulling left like it has somewhere to be? Steering wheel crooked when you're going straight? Tires wearing on the inside edge? Nick's Tire & Auto on Euclid Ave — Hunter rack, computerized four-wheel alignment, 45 minutes start to finish, walk-in 7 days. We pull-check free first so you know whether the car actually needs alignment or whether it's something else (tire pressure, suspension, balance). Serving Cleveland, Euclid, Cleveland Heights, Parma, East Cleveland, Lakewood, Lyndhurst, and the surrounding metro — pull up any day we're open.",
  startingPrice: "Free pull-check · written quote · walk-in 7 days",
  pricingTitle: "ALIGNMENT PRICING — STRAIGHTFORWARD",
  pricingSub: "Pull-check is free. If alignment is needed, you get the price in writing before we touch the wheels — you don't pay until you say yes.",
  tiers: [
    {
      name: "Two-Wheel Alignment",
      price: "From $69",
      sub: "front-wheel-drive cars · front axle only",
      use: "Older front-wheel-drive cars where the rear axle is not adjustable. Less common today but still right for some compacts and sedans.",
    },
    {
      name: "Four-Wheel Alignment",
      price: "From $89",
      sub: "the right answer for ~90% of Cleveland vehicles",
      use: "Computerized laser alignment of all four wheels. Standard for SUVs, trucks, and any car with independent rear suspension. The fix that holds.",
      featured: true,
    },
    {
      name: "Post-Collision / Specialty",
      price: "From $129",
      sub: "after a major pothole, accident, or suspension work",
      use: "Some vehicles need camber adjustment kits or rear-axle shimming. Pricing includes any specialty parts and the labor to install them.",
    },
  ],
  includedTitle: "WHAT EVERY ALIGNMENT AT NICK'S INCLUDES",
  includedSub: "No bare-minimum work. The alignment includes the checks it depends on.",
  included: [
    "Free pull-check + visual check BEFORE we lift the car",
    "Tire pressure check + adjustment (correct pressure is required for proper alignment)",
    "Suspension component visual check (worn tie rods or ball joints = bad alignment results)",
    "Computerized four-wheel laser alignment to manufacturer specs",
    "Before-and-after measurements printed for your records",
    "Test drive to confirm the pull is gone before you pay",
    "12-month parts / 90-day labor warranty",
    "If alignment isn't the actual problem, written estimate for what is",
  ],
  faqs: [
    {
      q: "How much does a wheel alignment cost in Cleveland?",
      a: "Two-wheel alignment from $69. Four-wheel alignment from $89 — the right call for ~90% of Cleveland vehicles. Post-collision or specialty alignments (camber kits, rear shims) from $129. The pull-check before alignment is free — we tell you whether the car actually needs alignment before charging for it.",
    },
    {
      q: "How long does a wheel alignment take?",
      a: "About 45 minutes start-to-finish for a four-wheel alignment. If you're a walk-in on a busy Saturday there might be a queue ahead of you — we'll give you a realistic wait estimate at the counter. Drop-off + Uber back home is free if you don't want to wait.",
    },
    {
      q: "How often should I get a wheel alignment?",
      a: "Cleveland's potholes + winter freeze-thaw cycle mean most local drivers benefit from a check every 12 months OR after any pothole-induced impact, any suspension work, any tire purchase, or any visible uneven tread wear. Twice yearly (spring + fall) is normal for cars that see a lot of city driving.",
    },
    {
      q: "How do I know if my car needs an alignment?",
      a: "Three primary signs: (1) the car pulls left or right when you let go of the wheel on a straight road; (2) the steering wheel is crooked when the car is going straight; (3) the tires wear unevenly — usually on the inside or outside shoulder. Other signs include vibration in the steering wheel, fuel economy drop, and the steering wheel feeling \"loose.\" The pull-check is free — drive in and we'll tell you.",
    },
    {
      q: "Is the alignment the same as tire balancing?",
      a: "No — different operations. Alignment adjusts the geometry of how the wheels attach to the suspension (camber, caster, toe). Balancing adjusts how the tire+wheel assembly spins (small weights clipped to the rim). A vibration at highway speed is usually balance; a pull or uneven wear is usually alignment. We can do both — they're often packaged together when new tires go on.",
    },
    {
      q: "Should I get alignment after new tires?",
      a: "Yes — and most reputable shops include it or strongly recommend it. New tires on a misaligned car wear unevenly from the very first mile, ruining a $300 set of tires inside 6 months. Nick's recommends the four-wheel alignment any time we install new tires — most customers add it to the tire purchase. The math saves money.",
    },
    {
      q: "Can a pothole knock my alignment out?",
      a: "Yes — Cleveland's potholes are aggressive enough that a single hard hit can shift camber or toe enough to start uneven wear. Watch for pull or vibration after a pothole; if you notice either, get the pull-check done within a week. Driving 1,000 miles with misalignment burns the inside edge off the tire and costs you 25-50% of its remaining life.",
    },
    {
      q: "Why are some shops charging $150+ for alignment?",
      a: "Two reasons: (1) the dealer adds a labor markup on top of base alignment; (2) some chains bundle in services you don't need (alignment + balance + rotation + tire-life check as a package). Nick's quotes alignment alone — if you need balance or rotation we'll tell you, but we don't bundle by default. Free pull-check means you know what you actually need before anything's billed.",
    },
  ],
  bookingService: "alignment",
  serviceType: "Wheel Alignment · Cleveland",
  ctaHeadline: "GET THE PULL-CHECK · FREE · WALK IN ANY DAY",
  // Hours come from BUSINESS: this line said "9am-6pm Mon-Sat" while the shop
  // opens at 8 (and the same page's header said 8AM).
  ctaSub: `${BUSINESS.address.street}, ${BUSINESS.address.city} ${BUSINESS.address.state} · ${BUSINESS.hours.display} · walk-in welcome · ${BUSINESS.phone.display}`,

  anchorTable: {
    serviceName: "Four-wheel alignment · Cleveland market quotes",
    rows: [
      { label: "Cleveland-area dealer (avg quote)", price: "$150-200" },
      { label: "National chain (Firestone / Mavis tier)", price: "$110-130" },
      { label: "Nick's Tire & Auto — four-wheel alignment", price: "From $89", ours: true },
    ],
    source: "Source: representative dealer + chain quotes for Cleveland metro, 2026. Final price varies by vehicle and any specialty hardware required.",
  },

  fearStats: {
    heading: "What 6 months of misalignment actually costs.",
    stats: [
      {
        value: "47%",
        consequence: "Increase in tire wear with even mild misalignment (0.5° toe out of spec). A $300 tire set burns to the cords inside 6 months instead of lasting 4 Cleveland seasons.",
      },
      {
        value: "$1,200",
        consequence: "Average cost of replacing all 4 tires early due to alignment-driven uneven wear. The $89 alignment would have prevented it.",
      },
      {
        value: "3-5%",
        consequence: "MPG loss with a misaligned vehicle. On a 12,000-mile/yr commute that's roughly $250 extra in fuel — and you're losing it every single year you skip alignment.",
      },
    ],
  },

  lossStats: [
    {
      amount: 5,
      unit: "per day",
      label: "in uneven tire wear + MPG burn",
      reason: "A misaligned car costs ~$3/day in extra gas + ~$2/day in accelerated tire-edge wear. A month of \"I'll get to it\" costs roughly $150 — over a year, the alignment pays for itself nearly 20×.",
    },
    {
      amount: 1200,
      unit: "replacement",
      label: "when uneven wear destroys the tire set",
      reason: "Six months of misalignment on a new tire set = inside-edge cord exposure = full replacement. Worst-case math when alignment goes ignored.",
      ctaHref: "tel:+12168620005",
      ctaLabel: "Free pull-check · walk in",
    },
  ],

  crossSell: {
    heading: "While the car is in the bay — what else might need attention?",
    items: [
      {
        tone: "warning",
        symptom: "New tires going on this visit?",
        consequence: "Putting new rubber on a misaligned car burns the inside edge off the tire within 6 months. The $89 alignment is the cheapest way to protect a $400 tire investment.",
        relief: "Alignment after tire installation is the right move 100% of the time. Most customers bundle them.",
        ctaLabel: "Tire inventory",
        ctaHref: "/tires",
        icon: <Car className="w-5 h-5" />,
      },
      {
        tone: "info",
        symptom: "Hit a pothole that's making the wheel shake?",
        consequence: "Pothole + vibration = often a bent wheel or thrown balance weight, NOT pure alignment. We'll diagnose both at once — alignment + balance + visual rim check, free.",
        relief: "Free pull-check + visual inspection covers both alignment AND obvious balance/wheel issues.",
        ctaLabel: "Tire repair · plug-and-patch",
        ctaHref: "/tires#tire-repair",
        icon: <Activity className="w-5 h-5" />,
      },
      {
        tone: "danger",
        symptom: "Suspension feels loose or clunky?",
        consequence: "Worn tie rods, ball joints, or sway-bar links cause alignment to drift right back out of spec after the service. The mechanical fix has to come first.",
        relief: "Suspension inspection — free with any alignment work. We tell you straight if the alignment will hold or if you've got a worn component to fix first.",
        ctaLabel: "Suspension repair",
        ctaHref: "/services",
        icon: <Wrench className="w-5 h-5" />,
      },
    ],
  },
});

export default function WheelAlignmentClevelandPage() {
  const { ratingDisplay: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();
  return <FocusedServicePage config={buildConfig(reviewRating, reviewCountDisplay)} />;
}
