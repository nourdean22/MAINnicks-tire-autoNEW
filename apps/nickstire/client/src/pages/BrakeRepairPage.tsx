/**
 * BrakeRepairPage — targeted SEO landing for "brake repair Cleveland" +
 * related queries. GSC (30d): /brakes 1,307 impressions at #37.7, 0 clicks.
 * Plus "brake repair cleveland oh" (69 imps #24.8), "brakes grinding",
 * etc. — this replaces the generic ServicePage route for /brakes with
 * a tighter, price-anchored, FAQ-schema conversion page.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { BRAKES_PHOTOS } from "@/components/PhotoRibbon";
import { Disc, Activity, Wrench } from "lucide-react";
import { Link } from "wouter";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/brakes",
  // 2026-05-06 wave-16 · pro photo pack: under-car brake repair action
  // per PLACEMENT_GUIDE.md "Brakes page" row — brakes are safety-driven,
  // the under-car scene reads serious + mechanical
  heroImage: "/photos/undercar-brake-repair-action.webp",
  title: "Brake Repair Euclid & Cleveland · Nick's Tire & Auto",
  description: "Brake repair in Euclid & Cleveland. Free inspections, pads & rotors, squeaking/grinding fixes. You don't pay until you say yes. Open 7 days. (216) 862-0005",
  eyebrow: "BRAKE REPAIR CLEVELAND · BRING YOUR EARS",
  h1: "CLEVELAND BRAKE REPAIR\nTHAT HANDS YOU THE FLASHLIGHT.",
  sub: (
    <>
      Squealing? Grinding? Pedal soft like Cleveland weather in March? Nick's Tire & Auto is your Euclid Ave destination for reliable <Link href="/brakes" className="underline text-primary hover:text-primary-foreground">brake repair in Euclid</Link> and Cleveland. Need to troubleshoot first? Try our <Link href="/diagnose" className="underline text-primary hover:text-primary-foreground">vehicle diagnostics symptom checker</Link>, or browse our complete <Link href="/services" className="underline text-primary hover:text-primary-foreground">services page</Link>. We lift the car, hand you the flashlight, and walk you under it so you see what's worn. Free check, written quote, and you don't pay until you say yes. Check out our <Link href="/financing" className="underline text-primary hover:text-primary-foreground">financing options for repairs</Link>, find <Link href="/tires" className="underline text-primary hover:text-primary-foreground">tire repair and replacement services</Link>, or <Link href="/contact" className="underline text-primary hover:text-primary-foreground">contact Nick’s Tire & Auto</Link> to drop off today.
    </>
  ),
  startingPrice: "Summer Special — up to 30% off brake service. Free check, written quote first.",
  pricingTitle: "SUMMER SPECIAL — BRAKE PRICING",
  pricingSub: "Summer Special pricing varies by vehicle. Drive in for a free check and a written quote — discounts up to 30% off standard rates. We show you the worn part on the lift before we touch the bill.",
  tiers: [
    { name: "Pad Replacement", price: "Summer Special", sub: "per axle · up to 30% off · price varies by vehicle", use: "Pads worn, rotors still within spec. The cheapest stop-pedal fix that exists. Out the door in 60 minutes. Come in for your written quote." },
    { name: "Pads + Rotors", price: "Summer Special", sub: "per axle · up to 30% off · price varies by vehicle", use: "Rotors scored from a winter of too many late-stops. The most common Cleveland brake job by a country mile. Drive in today for pricing.", featured: true },
    { name: "Full Brake Job", price: "Summer Special", sub: "per axle · includes calipers if needed", use: "Calipers seized, lines leaking, full system refresh. The once-a-decade reset that buys you another 60K miles. Summer Special pricing — come in for a quote." },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Every brake service at Nick's comes with this — we tell you the cost before we touch anything.",
  included: [
    "Free brake check (no obligation)",
    "Measurement of pad thickness and rotor wear",
    "OE-spec brake pads (ceramic or semi-metallic per vehicle spec)",
    "New rotors if measured below minimum thickness",
    "Caliper slide lubrication",
    "Brake fluid top-off",
    "Full brake system test drive",
    "12-month / 12,000-mile warranty on parts and labor",
  ],
  symptomsSection: {
    heading: "DOES YOUR CAR HAVE THESE BRAKE WARNING SIGNS?",
    symptoms: [
      { title: "Squeaking Brakes", desc: "A high-pitched squeak or squeal when applying brakes is usually the wear indicator telling you the pads are getting thin and need inspection." },
      { title: "Grinding Brakes", desc: "A harsh metal-on-metal grinding sound means the pads are completely worn through and are scoring the rotors. Seek inspection immediately to prevent severe damage." },
      { title: "Soft or Spongy Brake Pedal", desc: "If the brake pedal feels mushy or goes almost to the floor, you may have air in the brake lines, a hydraulic leak, or low brake fluid. Do not drive on a soft pedal." },
      { title: "Vehicle Pulling While Braking", desc: "If the vehicle pulls to one side when you brake, it could indicate a seized caliper, uneven pad wear, or a collapsed brake hose." },
      { title: "Brake Vibration & Shaking", desc: "A pulsating or vibrating sensation in the brake pedal or steering wheel during stops is a classic sign of warped brake rotors." },
      { title: "Longer Stopping Distances", desc: "If you feel your vehicle is taking longer to halt, your brake pads may have lost their friction capability due to excessive wear or glazing." },
      { title: "Brake Warning Lights", desc: "An illuminated red brake light or amber ABS light on the dashboard indicates a system diagnostic code or low fluid pressure. Get it scanned." },
      { title: "Burning Smells", desc: "A sharp, chemical burning smell after heavy braking suggests overheated pads or a seized caliper dragging on the rotor." }
    ]
  },
  diagnosticAuthority: {
    heading: "CLEVELAND BRAKE REPAIR — REAL VALUE",
    content: [
      <>
        At Nick's Tire & Auto, we don't believe in mystery pricing or surprise fees. When you bring your vehicle in for a brake concern, our ASE-trained crew performs a full visual check of the pads, rotors, calipers, and hydraulic system.
      </>,
      <>
        We use micrometers and digital calipers to measure exact pad wear and rotor thickness against manufacturer minimum specifications. We'll walk you under the lift, show you the measurements, and explain exactly what needs replacement.
      </>,
      <>
        Whether you need a simple pad swap, new rotors, or caliper replacement, we source OE-spec parts and back them with our 12-month / 12,000-mile warranty. If your brakes are squealing or grinding, <Link href="/contact" className="underline text-[#FDB913] hover:text-primary">contact Nick's Tire & Auto</Link> for a free check today.
      </>
    ]
  },
  showTrustBlock: true,
  faqs: [
    { q: "How often should brakes be inspected?", a: "Brakes should be inspected at least once a year or every 12,000 miles. However, you should get a brake check immediately if you experience squealing, grinding, a soft brake pedal, steering vibration, or if the brake warning light lights up on your dashboard." },
    { q: "What are the common signs of worn brake pads?", a: "Classic signs include squeaking or squealing when you brake (wear indicators), grinding (metal-on-metal, pads fully worn), soft or spongy pedal (air in lines or low fluid), pulsation through the pedal (warped rotors), or the dashboard brake light stays on." },
    { q: "Do I always have to replace my rotors when changing brake pads?", a: "Not always. If the rotors are still above the minimum safe thickness and have no deep scoring or warping, we can reuse or resurface them. However, if they are scored, thin, or warped, we must replace them along with the pads to ensure proper stopping power and warranty coverage." },
    { q: "Why do my brakes make noise, and is it dangerous?", a: "Squeaking can be a warning sign that pads are thin, or from surface rust. Grinding, however, is extremely dangerous as it means metal is rubbing against metal, which significantly increases stopping distances and ruins the rotors. Grinding brakes should be inspected immediately." },
    { q: "My brake warning light is on — can I drive?", a: "If it's the ABS light only, you can drive cautiously to the shop. If it's the brake warning light (red), that means low brake fluid or a hydraulic problem — pull over and call us. Driving on a failing brake system is how accidents happen." },
    { q: "How do I schedule a brake inspection at Nick's?", a: "No appointment is needed! Nick's Tire & Auto runs on a first-come, first-served basis. You can walk in 7 days a week (Mon-Sat 8-6, Sun 9-4) at 17625 Euclid Ave, Cleveland. You can also schedule a vehicle drop-off online or call us ahead at (216) 862-0005." },
    { q: "How much does a brake job cost in Cleveland?", a: "It depends on what's worn — pads only is the cheapest fix; pads + rotors is the most common; full brake jobs (calipers, lines) run highest. The free check tells us exactly what's needed. We give you a written quote before any work and explain why each part is being replaced. No upsells, no boilerplate quotes — you don't pay until you say yes." },
    { q: "How long does brake repair take?", a: "Most pad replacements average about 60 minutes per axle — check out our reviews, we're the fastest in the city. Pads + rotors usually 90 minutes. If you drop off before 10 AM, it's done same day. Walk-ins welcome but calling ahead at (216) 862-0005 lets us have the right parts ready." },
    { q: "Do you replace brakes on European cars?", a: "Yes — we service BMW, Mercedes, Audi, Volkswagen, Volvo, Porsche, and most European brands. These typically use specific pads and sensors; we stock or source OE-spec parts and reset the wear indicator on your dashboard after service." },
    { q: "Do you offer a warranty on brake work?", a: "Every brake job includes our 12-month / 12,000-mile warranty covering parts and labor. If a pad is defective or fails early, we replace it free. Real warranty — not the 'comes with a sticker but good luck claiming it' kind." },
  ],
  bookingService: "brakes",
  serviceType: "Brake Repair",
  aeoAnswer: "For brake repair in Cleveland, Nick's Tire & Auto at 17625 Euclid Ave (44112, east side) does a free brake check with a written quote before any work - and you don't pay until you say yes. Pad replacement starts at $149 per axle, open 7 days a week, 4.9 stars from 1,700+ drivers. Call (216) 862-0005 or walk in.",
  // Curiosity arc (2026-05-30) — hero hook = self-relevant gap (no $; the
  // $149/$279 tiers below are the payoff); stakes hook reframes "can it wait?"
  // and pulls into the fear stats (which substantiate the cascade cost).
  curiosityArc: {
    heroHook: "Summer Special — up to 30% off. Which brakes does your car need?",
    stakesHook: "Wondering if it can wait? Worn pads draw a line — and every week pushes you past it.",
  },
  ctaHeadline: "BOOK YOUR BRAKE SERVICE",
  ctaSub: "Free check, written quote, you don't pay until you say yes. Walk in or drop off — 17625 Euclid Ave, Euclid/Cleveland OH.",

  // ─── CONVERSION ARCHITECTURE ──────────────────────────
  anchorTable: {
    serviceName: "Brake repair, per axle — Cleveland market quotes",
    rows: [
      { label: "Cleveland-area dealer (avg quote)", price: "$800" },
      { label: "National chain (Firestone / Midas tier)", price: "$600" },
      { label: "Nick's Tire & Auto", price: "From $149", ours: true },
    ],
    source: "Source: representative dealer + chain quotes for pad replacement, Cleveland metro 2026. Final price varies by vehicle.",
  },
  fearStats: {
    heading: "What worn brakes actually do — the math you don't want to learn at 60 mph.",
    stats: [
      {
        value: "287",
        unit: "feet",
        consequence: "Added stopping distance at 60 mph with metal-on-metal brakes vs. fresh pads. That's roughly two football fields beyond where you thought you'd stop.",
        source: "NHTSA stopping-distance data; pad-thickness vs. friction-coefficient curves.",
      },
      {
        value: "400°F",
        consequence: "Boiling point of fresh DOT-3 brake fluid. Old (1-year+) fluid drops to ~280°F — heavy braking on Cleveland hills boils it, you get a pedal that goes to the floor with zero stopping power.",
      },
      {
        value: "$3,800",
        consequence: "Average bill when grinding brakes are ignored long enough to ruin the rotor + caliper + master cylinder. A pad job caught early is a fraction of that — the longer metal grinds on metal, the more parts get dragged into the repair.",
      },
    ],
  },
  lossStats: [
    {
      amount: 8.5,
      unit: "per day",
      label: "in compounding rotor damage",
      reason: "Once the pad backing meets the rotor, every stop scores the metal deeper. Wait two weeks and a pads-only job typically becomes a pads + rotors job — a real jump on the final invoice. A free check tells you exactly which side of that line you're on, before it costs more.",
      ctaHref: "#booking",
      ctaLabel: "STOP THE DAMAGE TODAY",
    },
  ],
  photoRibbon: {
    photos: BRAKES_PHOTOS,
    eyebrow: "Brake bays · Pads on the bench · Real lift-ups",
    headingLine1: "We do this every day,",
    headingLine2: "and it's not theatre.",
    subhead: "Real lifts, real measurements, real customers — no stock photos, no fake \"shop tour\" video.",
  },
  crossSell: {
    heading: "While you're here — what else might your car need?",
    items: [
      {
        tone: "warning",
        icon: <Wrench className="w-5 h-5" />,
        symptom: "Steering wheel shaking when you brake?",
        consequence: "Warped rotor — same family of problem, often shows up next to worn pads.",
        relief: "Resurface or replace, $0 add-on if we're already in there.",
        ctaLabel: "WHEEL ALIGNMENT",
        ctaHref: "/alignment",
      },
      {
        tone: "info",
        icon: <Activity className="w-5 h-5" />,
        symptom: "Check-engine light on at the same time?",
        consequence: "ABS module faults can trigger both — worth scanning together.",
        relief: "Free 5-min code scan. Rolled into the brake-job visit.",
        ctaLabel: "RUN DIAGNOSTICS",
        ctaHref: "/diagnostics",
      },
      {
        tone: "info",
        icon: <Disc className="w-5 h-5" />,
        symptom: "Tires bald or wearing uneven?",
        consequence: "Worn brakes + worn tires = doubled stopping distance. Both at once is a real risk.",
        relief: "Used tires from $25 installed in 20 minutes — done while we do brakes.",
        ctaLabel: "GET TIRES",
        ctaHref: "/tires",
      },
    ],
  },
};

export default function BrakeRepairPage() {
  // wave-fix-2026-05-28 · FAQPage JSON-LD is emitted ONCE by
  // FocusedServicePage from CONFIG.faqs (see FocusedServicePage.tsx
  // ~L587). The earlier manual <FAQPageSchema> here double-emitted the
  // FAQPage block on /brakes — exactly the "Duplicate field FAQPage"
  // GSC error the template's own comment warns against. Removed; the
  // template's built-in is the single source of truth.
  return <FocusedServicePage config={CONFIG} />;
}
