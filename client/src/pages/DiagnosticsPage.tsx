/**
 * DiagnosticsPage — "check engine light" + "car diagnostics" queries.
 * GSC (30d): /diagnostics 2,112 impressions at #58.5 with 0 clicks.
 * Plus "check engine light service" (1,089 imps #65.9), "check engine
 * light cleveland" (151 imps #13.1) — this page captures the cluster.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/diagnostics",
  title: "Check Engine Light & Car Diagnostics Cleveland | Free Scan | Nick's Tire & Auto",
  description: "Check engine light on? Free code scan at Nick's Tire & Auto in Cleveland/Euclid. Honest diagnosis, no upsell. Most scans in 15 min. Walk-ins 7 days. (216) 862-0005",
  eyebrow: "DIAGNOSTICS",
  h1: "CHECK ENGINE LIGHT CLEVELAND",
  sub: "Check engine light on? Pull up. Free code scan at Nick's Tire & Auto. We tell you what the code actually means — and what it'll really cost to fix — before you authorize anything. 30+ years diagnosing Cleveland cars.",
  startingPrice: "Free code scan",
  pricingTitle: "DIAGNOSTIC PRICING",
  pricingSub: "Starts free. Complex electrical work priced up front — no surprises.",
  tiers: [
    { name: "Code Scan", price: "FREE", sub: "OBD-II pull + code lookup", use: "You want to know what triggered the light" },
    { name: "Full Diagnostic", price: "$95", sub: "most issues, applied toward repair", use: "Tough intermittent problem requiring live data + component testing", featured: true },
    { name: "Electrical / Wiring", price: "$150+", sub: "per hour on complex issues", use: "Harness damage, CAN bus faults, parasitic battery drain" },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Honest diagnosis, clear explanation. No fear tactics.",
  included: [
    "OBD-II code pull (all stored + pending codes)",
    "Freeze-frame data review",
    "Live sensor data analysis when needed",
    "Visual engine bay + under-car inspection",
    "Honest explanation of what the code means",
    "Written estimate of repair cost (if needed)",
    "Diagnostic fee credited toward approved repair",
    "No pressure upsell — you decide what to fix",
  ],
  faqs: [
    { q: "Is the code scan really free?", a: "Yes — pull up, we read the code in 5 minutes, tell you what it means. No charge. If the issue needs further diagnosis (intermittent faults, electrical, sensor failures requiring live data), that's when the $95 full diagnostic comes in — and we apply it to the repair if you have us do the work." },
    { q: "What does my check engine light mean?", a: "Could be anything from a loose gas cap ($0) to a failing catalytic converter ($800). Common causes: oxygen sensor, mass airflow sensor, spark plugs, evaporative emissions leak, catalytic converter, gas cap. The code tells us where to look; the real diagnosis happens in the inspection. We won't guess — we test." },
    { q: "Can I drive with the check engine light on?", a: "If the light is solid (not flashing), you can usually drive to the shop safely — the engine thinks something's off but isn't in danger. If the light is FLASHING, that means active misfire and driving can destroy the catalytic converter ($1,500+ part). Pull over and call us." },
    { q: "How long does diagnostics take?", a: "Basic code scan: 10-15 minutes. Full diagnostic with live data + inspection: 45-90 minutes. Complex intermittent faults can take several hours across visits if we need to observe the issue when it occurs. We'll call with updates — no surprise work." },
    { q: "Why won't my car pass Ohio E-Check?", a: "Most E-Check failures come from: evaporative system leaks (bad gas cap, loose hose), catalytic converter below efficiency, oxygen sensor wear, or a recent battery disconnect preventing 'readiness monitors' from completing. We diagnose and fix, then you re-test. Most E-Check repairs $150-$600 at Nick's." },
    { q: "Will turning the car off reset the light?", a: "Sometimes — if the issue was transient (bad tank of gas, brief sensor glitch), the light resets after 3 successful drive cycles. If it comes right back on, there's a real problem. Don't clear codes yourself before bringing it in — we need the history to diagnose properly." },
    { q: "Do you work on European and import vehicles?", a: "Yes — BMW, Mercedes, Audi, VW, Volvo, Porsche, and most imports. European cars use proprietary diagnostic protocols beyond OBD-II; we have the scanners and experience to read them. Often half the price of the dealership." },
  ],
  bookingService: "diagnostics",
  serviceType: "Vehicle Diagnostics",
  ctaHeadline: "BOOK A DIAGNOSTIC",
  ctaSub: "Free code scan, honest diagnosis. Walk in or book below — 17625 Euclid Ave, Cleveland OH.",
};

export default function DiagnosticsPage() {
  return <FocusedServicePage config={CONFIG} />;
}
