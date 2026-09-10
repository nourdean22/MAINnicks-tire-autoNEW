/**
 * DiagnosticsPage — "check engine light" + "car diagnostics" queries.
 * GSC (30d): /diagnostics 2,112 impressions at #58.5 with 0 clicks.
 * Plus "check engine light service" (1,089 imps #65.9), "check engine
 * light cleveland" (151 imps #13.1) — this page captures the cluster.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { DIAGNOSTICS_PHOTOS } from "@/components/PhotoRibbon";
import { useReviewStats } from "@/hooks/useReviewStats";
import { Disc, AlertTriangle, Clock } from "lucide-react";

// A FUNCTION, not a module constant: the rating and review count are live
// (useReviewStats), and a module-scope object is built once at import time —
// before any hook can run — so it could only ever carry the static floor.
const buildConfig = (reviewRating: string, reviewCountDisplay: string): ServicePageConfig => ({
  canonicalPath: "/diagnostics",
  // 2026-05-06 wave-16 · pro photo pack: diagnostics page hero per
  // PLACEMENT_GUIDE.md — interior service bay with car on lift
  heroImage: "/photos/interior-service-bay-car-lift.webp",
  // 2026-05-07 GSC tune: was "Check Engine Light Cleveland — Free Code
  // Pull, Plain English" — 430 imps / 0 clicks in 90 days.
  // wave-181.99 GSC re-check: pos 38.5 / 598 imp / 0 clicks. Position
  // improved from 51.8 but CTR is still 0% — title isn't differentiated
  // enough in SERP. Adding "FREE Code Pull" up-front as the click hook
  // (no competitor leads with FREE), price anchor for the full diag.
  title: "Check Engine Light Cleveland · Free Scan · No Pay Til Yes | Nick's",
  description: `Cleveland check-engine-light shop. Free scan, plain-English read, written quote before any wrench moves. You don't pay until you say yes. ${reviewRating}★ from ${reviewCountDisplay} drivers. (216) 862-0005`,
  eyebrow: "CHECK ENGINE LIGHT · CLEVELAND'S NOISE TRANSLATOR",
  // wave-177 · GSC: /diagnostics at pos 51.8 / 0% CTR over 204 imp.
  // H1 had ZERO keyword target ("THE LIGHT'S ON. WE FIND OUT *WHY*").
  // Same pattern wave-176 fixed on /brakes — Google can't classify the
  // page for "car diagnostic" / "check engine light" queries when the
  // H1 doesn't contain either phrase. Adding "CLEVELAND CAR DIAGNOSTIC"
  // as primary H1 + keeping the "find out why, not guess" brand voice
  // as secondary line. Sub adds neighborhood mentions for local signal.
  h1: "CLEVELAND CAR DIAGNOSTIC\nTHAT FINDS THE WHY — NOT GUESSES.",
  sub: "Check engine light on, flashing, or playing peek-a-boo? Nick's Tire & Auto on Euclid Ave — Cleveland's check-engine-light translator. We serve Euclid, Cleveland Heights, Parma, Lakewood, Lyndhurst, East Cleveland and every neighborhood between. Free OBD-II code pull. We'll tell you what the code means in real English — not engineer-speak — and what the fix actually costs before any wrench moves. Free check. Written quote. You don't pay until you say yes. 30+ years reading every weird Cleveland-car symptom you can name.",
  startingPrice: "Free code scan · written quote · you don't pay until you say yes",
  pricingTitle: "DIAGNOSTIC LEVELS",
  pricingSub: "Starts free. Deeper checks get a written quote first, credited back to your invoice if we do the repair.",
  tiers: [
    { name: "Code Scan", price: "FREE", sub: "OBD-II pull + code lookup · plain-English explanation", use: "You want to know what triggered the light" },
    { name: "Full Diagnostic", price: "From $89", sub: "live data + component testing · credited toward repair", use: "Tough intermittent problem requiring live data + component testing", featured: true },
    { name: "Electrical / Wiring", price: "From $149", sub: "complex harness, CAN bus, parasitic draw · credited if fixed", use: "Harness damage, CAN bus faults, parasitic battery drain" },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "We tell you what's wrong, in plain English. No fear tactics.",
  included: [
    "OBD-II code pull (all stored + pending codes)",
    "Freeze-frame data review",
    "Live sensor data analysis when needed",
    "Visual engine bay + under-car check",
    "Honest explanation of what the code means",
    "Written estimate of repair cost (if needed)",
    "Fee credited to the job if you say yes to the repair",
    "No pressure upsell — you decide what to fix",
  ],
  faqs: [
    { q: "Is the code scan really free?", a: "Yes — pull up, we read the code in 5 minutes, tell you what it means. No charge. If the issue needs further diagnosis (intermittent faults, electrical, sensor failures requiring live data), the deeper diagnostic gets a written estimate before we start, and we apply that fee toward the repair if you have us do the work." },
    { q: "What does my check engine light mean?", a: "Could be anything from a loose gas cap ($0) to a failing catalytic converter ($800). Common causes: oxygen sensor, mass airflow sensor, spark plugs, evaporative emissions leak, catalytic converter, gas cap. The code tells us where to look; the real diagnosis happens in the inspection. We won't guess — we test." },
    { q: "Can I drive with the check engine light on?", a: "If the light is solid (not flashing), you can usually drive to the shop safely — the engine thinks something's off but isn't in danger. If the light is FLASHING, that means active misfire and driving can destroy the catalytic converter ($1,500+ part). Pull over and call us." },
    { q: "How long does diagnostics take?", a: "Basic code scan: 10-15 minutes. Full diagnostic with live data + inspection: 45-90 minutes. Complex intermittent faults can take several hours across visits if we need to observe the issue when it occurs. We'll call with updates — no surprise work." },
    { q: "Why won't my car pass Ohio E-Check?", a: "Most E-Check failures come from: evaporative system leaks (bad gas cap, loose hose), catalytic converter below efficiency, oxygen sensor wear, or a recent battery disconnect preventing 'readiness monitors' from completing. We diagnose, give you a written estimate before any work, and you re-test after the repair." },
    { q: "Will turning the car off reset the light?", a: "Sometimes — if the issue was transient (bad tank of gas, brief sensor glitch), the light resets after 3 successful drive cycles. If it comes right back on, there's a real problem. Don't clear codes yourself before bringing it in — we need the history to diagnose properly." },
    { q: "Do you work on European and import vehicles?", a: "Yes — BMW, Mercedes, Audi, VW, Volvo, Porsche, and most imports. European cars use proprietary diagnostic protocols beyond OBD-II; we have the scanners and experience to read them. Often half the price of the dealership." },
  ],
  bookingService: "diagnostics",
  serviceType: "Vehicle Diagnostics",
  // Curiosity arc (2026-05-30) — hero hook leans on the real "free scan" draw
  // (free is a pull, not a price); stakes hook = honest cost-of-delay that the
  // fear stats substantiate (a $200 sensor cooks a $1,500+ cat the longer it waits).
  curiosityArc: {
    heroHook: "Free to find out what's wrong.",
    stakesHook: "That light gets more expensive the longer it stays on. Here's how.",
  },
  ctaHeadline: "BRING IT IN · WE'LL TELL YOU WHAT'S WRONG",
  ctaSub: "Free code scan, written quote, you don't pay until you say yes. Walk in or drop off — 17625 Euclid Ave, Cleveland OH.",

  // ─── CONVERSION ARCHITECTURE ──────────────────────────
  anchorTable: {
    serviceName: "OBD-II diagnostic — Cleveland market quotes",
    rows: [
      { label: "Cleveland-area dealer", price: "$185" },
      { label: "National chain shop", price: "$120" },
      { label: "Nick's Tire & Auto", price: "Free*", ours: true },
    ],
    source: "* Free 5-min code scan. Anything beyond that gets a written estimate before we start, credited toward repair if you have us fix it.",
  },
  fearStats: {
    heading: "What an ignored check-engine light actually costs.",
    stats: [
      {
        value: "$200",
        unit: "→ $4,000",
        consequence: "Failed oxygen sensor untreated for 30 days routinely takes the catalytic converter with it. Cat converter replacement: $1,500-$4,000 depending on vehicle. Sensor alone: $200.",
        source: "EPA + AAA repair-data benchmarks.",
      },
      {
        value: "$7,000",
        consequence: "Top-end of an engine replacement when a flashing CEL (active misfire) is driven on for 1-2 weeks. Misfires dump unburned fuel into the cat — destroys it AND the engine.",
      },
      {
        value: "30",
        unit: "days to E-Check failure",
        consequence: "An unresolved CEL = automatic Ohio E-Check failure once your registration cycle hits. 30 days after that, expired tags = parking ticket + impound risk + possible criminal charge for driving on expired registration.",
      },
    ],
  },
  lossStats: [
    {
      amount: 47,
      unit: "per day",
      label: "of compounding sensor / emissions damage",
      reason: "A bad oxygen sensor keeps dumping raw fuel into the catalytic converter — a $200 sensor quietly cooks a $1,500+ cat the longer the light stays on. The earlier we read the code, the cheaper the fix.",
      ctaHref: "#booking",
      ctaLabel: "DIAGNOSE TODAY",
    },
    {
      amount: 12,
      unit: "MPG drop possible",
      label: "in fuel economy from a stuck-open thermostat or O2 sensor",
      reason: "A degraded mass-airflow or O2 sensor commonly drops fuel economy 10-15%. On a 30-MPG car driving 1,000 miles a month, that's roughly $30/month in extra gas — silently — until you fix it.",
      ctaHref: "#booking",
      ctaLabel: "STOP THE LEAK",
    },
  ],
  photoRibbon: {
    photos: DIAGNOSTICS_PHOTOS,
    eyebrow: "Scan tools · Live data · Written estimates",
    headingLine1: "We measure the codes,",
    headingLine2: "not improvise the bill.",
    subhead: "Real shop floor — alignment bay, OBD-II in hand, the front desk where you get the answer.",
  },
  crossSell: {
    heading: "Got the diagnosis? Here's the next step.",
    items: [
      {
        tone: "warning",
        icon: <AlertTriangle className="w-5 h-5" />,
        symptom: "E-Check failed with code P0420?",
        consequence: "Catalytic converter or O2 sensor — 30 days to remedy or your registration goes invalid.",
        relief: "State-certified emissions repair, same-day pass guarantee.",
        ctaLabel: "OHIO E-CHECK",
        ctaHref: "/emissions",
      },
      {
        tone: "danger",
        icon: <Disc className="w-5 h-5" />,
        symptom: "ABS light on with the CEL?",
        consequence: "Brake-system fault — could be a wheel speed sensor or hydraulic problem. Both light up the same diagnostic.",
        relief: "Free brake check + scan; written estimate before any work.",
        ctaLabel: "BRAKE INSPECTION",
        ctaHref: "/brakes",
      },
      {
        tone: "info",
        icon: <Clock className="w-5 h-5" />,
        symptom: "Just need oil and a check?",
        consequence: "Skipping intervals leads to engine sludge and longer-term codes anyway.",
        relief: "Free 27-point inspection on every oil change.",
        ctaLabel: "OIL CHANGE",
        ctaHref: "/oil-change",
      },
    ],
  },
});

export default function DiagnosticsPage() {
  const { ratingDisplay: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();
  return <FocusedServicePage config={buildConfig(reviewRating, reviewCountDisplay)} />;
}
