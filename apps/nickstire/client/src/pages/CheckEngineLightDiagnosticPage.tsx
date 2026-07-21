/**
 * CheckEngineLightDiagnosticPage — silo for "check engine light
 * diagnostic" + "professional diagnostic test" intent.
 *
 * Differentiates from /diagnostics (broader free-code-scan framing):
 *   /diagnostics                      — "free code scan, here's what it means"
 *   /check-engine-light-diagnostic    — "diagnostic AUTHORITY — the
 *                                        place that ends the parts-swap
 *                                        cycle other shops put you on"
 *
 * Per the 2026-05-02 Grounded & Reliable strategy memo. Positions
 * Nick's as the diagnostic authority that saves the customer from
 * unnecessary parts replacement. The "parts swapping" thread runs
 * through copy, FAQs, and the fear-calibration section.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { Search, AlertTriangle, ShieldCheck } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/check-engine-light-diagnostic",
  // 2026-05-06 copy wave: title now names the anti-pattern that's
  // this page's whole positioning. Operators 4 + 5.
  title: "Check Engine Light Cleveland · No Parts-Swap · No Pay Til Yes | Nick's",
  description: "Cleveland shop that tests instead of swapping parts. Free scan, written quote before any wrench moves. You don't pay until you say yes. Walk-ins 7 days. 4.9★ 1,700+ reviews.",
  eyebrow: "WE TEST · WE DON'T GUESS",
  h1: "WE'LL TELL YOU WHAT'S WRONG.\nNO PARTS-SWAP ROULETTE.",
  sub: "If you've been to a shop that 'tried a sensor, then another, then another' — you've been parts-swapped. We don't guess. We test. Live data, freeze-frame review, component isolation. You leave knowing what's actually wrong and what it'll cost — free check, written quote, you don't pay until you say yes.",
  startingPrice: "Free code scan",
  pricingTitle: "DIAGNOSTIC LEVELS",
  pricingSub: "Free start. Deeper testing gets a written estimate before we touch anything — and credits toward the repair.",
  tiers: [
    { name: "OBD-II Code Scan", price: "FREE", sub: "stored + pending codes + freeze-frame", use: "You want to know what triggered the light right now" },
    { name: "Full Diagnostic", price: "Free estimate", sub: "live data + component isolation, credited to repair", use: "Persistent or intermittent issue — we find the actual failed component, not a list of suspects", featured: true },
    { name: "Electrical / CAN Bus", price: "Free estimate", sub: "harness, modules, parasitic draw", use: "Modern car electronics where parts-swap shops give up" },
  ],
  includedTitle: "WHY 'WE TEST · WE DON'T GUESS' MEANS SOMETHING",
  includedSub: "What we do that the parts-swap shops skip.",
  included: [
    "OBD-II code pull with all stored, pending, AND permanent codes",
    "Freeze-frame data review (the conditions when the code triggered)",
    "Live data analysis — we watch the sensor while the engine runs",
    "Component isolation testing before any part is replaced",
    "Visual under-hood + under-car check (cracks, leaks, rodent damage)",
    "Manufacturer-specific scan tools for European, Asian, and domestic vehicles",
    "Written report — exact part, exact reason, exact cost",
    "30+ years of pattern recognition — we've seen this code on this car before",
  ],
  faqs: [
    { q: "What does 'parts swapping' mean and why is it bad?", a: "It's when a shop replaces components in sequence hoping one of them fixes the issue. You pay for every part they try plus the labor to install it. We've had customers come in $1,200 deep on a misfire chase that turned out to be a $40 ignition coil — they paid for plugs, plug wires, fuel injector cleaning, and a coil-pack swap (wrong cylinder) before someone actually tested the cylinder pressure. Real diagnostics finds the failed component on the first test." },
    { q: "How is your diagnostic different from a parts-store free code reader?", a: "Parts stores read the code and stop there. The code says 'P0420 — catalyst efficiency below threshold.' That's the SYMPTOM. The cause could be: failed catalytic converter, failed O2 sensor, exhaust leak, engine-side issue dumping unburned fuel. Replacing the cat without identifying which one = $1,500 down the drain if it's actually the upstream sensor. We isolate before we recommend." },
    { q: "Is the code scan really free?", a: "Yes — pull up, we read codes in 5 minutes, give you our honest read. No charge. If the issue requires deeper testing (intermittent faults, electrical, sensor failures needing live data), the deeper diagnostic gets a written estimate before we start, AND we apply that fee toward the repair if you have us do the work." },
    { q: "Why has my CEL kept coming back after multiple repairs?", a: "Two reasons usually: (1) the underlying root cause was never identified — a downstream symptom got fixed but the upstream cause kept failing the new part; (2) the readiness monitors weren't allowed to complete after the battery disconnect. Bring it in — we'll re-pull codes, review your repair history (bring receipts if you have them), and run live data to find what's actually broken." },
    { q: "Can I drive with the check engine light on?", a: "Solid light: usually safe to drive to the shop. Flashing light: STOP. Flashing means active misfire — driving for even 30 minutes with a flashing CEL can destroy the catalytic converter ($1,500+ part) AND damage the engine. Pull over, call (216) 862-0005, we'll talk you through whether to drive in or get towed." },
    { q: "Do you do the actual repair, or only the check?", a: "Both — and the check fee credits toward the repair when you say yes. We're a full repair shop with a 12-month parts / 90-day labor warranty. You're not just paying for an answer you have to take elsewhere." },
    { q: "What about European cars (BMW, Mercedes, Audi)?", a: "Yes — we have the manufacturer-specific scan tools (not just OBD-II). European cars use proprietary diagnostic protocols and module communication; generic scanners miss most of it. We're often half the dealership price with the same depth of diagnosis." },
  ],
  bookingService: "diagnostics",
  serviceType: "Diagnostic Service",
  ctaHeadline: "BRING IT IN · WE'LL TELL YOU WHAT'S WRONG",
  ctaSub: "Free code scan, written quote before any work, you don't pay until you say yes. Walk-ins welcome — 17625 Euclid Ave, Cleveland OH.",

  // ─── CONVERSION ARCHITECTURE ──────────────────────────
  anchorTable: {
    serviceName: "Diagnostic + first-attempt fix — Cleveland market",
    rows: [
      { label: "Cleveland dealer (parts-swap risk high)", price: "$185 + parts" },
      { label: "Chain shop (often parts-swappers)", price: "$120 + retried parts" },
      { label: "Nick's Tire & Auto — root-cause first time", price: "Free scan + estimate", ours: true },
    ],
    source: "Representative quote benchmarks. Real bills come from a free written estimate after diagnosis. The savings come from NOT paying for replaced parts that didn't fix anything.",
  },
  fearStats: {
    heading: "What \"just trying parts\" actually costs.",
    stats: [
      {
        value: "$1,200",
        consequence: "Average bill we see when a customer arrives mid-misfire-chase. Plugs, wires, coils, injector cleaning, sometimes a wrong-cylinder coil-pack — all replaced before anyone tested cylinder compression. The actual fix usually costs under $200.",
        source: "Customer intake data, Nick's Tire & Auto repair history, 2024-2026.",
      },
      {
        value: "$4,000",
        consequence: "Catalytic converter replacement on a sedan when an unaddressed upstream O2 sensor or misfire ran into the cat. The cat fails downstream of an unfixed root cause — replacing the cat without fixing the upstream issue means the new cat fails too.",
        source: "AAA + EPA repair-cost benchmarks.",
      },
      {
        value: "30",
        unit: "days to E-Check fail",
        consequence: "An unresolved CEL automatically fails Ohio E-Check on your registration cycle. 30 days after expired registration = parking ticket + impound risk + driving-on-expired-registration charge.",
      },
    ],
  },
  lossStats: [
    {
      amount: 40,
      unit: "per day",
      label: "you wait while the upstream cause keeps damaging the downstream component",
      reason: "A failing O2 sensor that triggered your CEL is dumping data your engine relies on. The ECM compensates with bad fuel/air mixture, which loads the catalytic converter with unburned fuel, which heats and degrades it. Every day = downstream damage on top of the original problem.",
      ctaHref: "#booking",
      ctaLabel: "BOOK A DIAGNOSTIC",
    },
  ],
  crossSell: {
    heading: "What's actually wrong? Pick the right entry point.",
    items: [
      {
        tone: "warning",
        icon: <Search className="w-5 h-5" />,
        symptom: "Light came on out of nowhere?",
        consequence: "Could be a $0 fix (gas cap) or $4,000 (cat converter). Free scan tells you in 5 min.",
        relief: "Free OBD-II scan + honest read.",
        ctaLabel: "FREE SCAN",
        ctaHref: "/diagnostics",
      },
      {
        tone: "danger",
        icon: <AlertTriangle className="w-5 h-5" />,
        symptom: "Multiple shops, light still on?",
        consequence: "You're being parts-swapped. We test before we replace.",
        relief: "Full diagnostic with live data + component isolation.",
        ctaLabel: "GET REAL DIAGNOSIS",
        ctaHref: "/booking?service=diagnostics",
      },
      {
        tone: "info",
        icon: <ShieldCheck className="w-5 h-5" />,
        symptom: "Failed E-Check?",
        consequence: "30-day clock to fix it before registration expires.",
        relief: "Free pre-test scan + written repair estimate.",
        ctaLabel: "E-CHECK REPAIR",
        ctaHref: "/emissions",
      },
    ],
  },
};

export default function CheckEngineLightDiagnosticPage() {
  return <FocusedServicePage config={CONFIG} />;
}
