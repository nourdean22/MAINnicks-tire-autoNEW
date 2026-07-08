/**
 * Per-service conversion-architecture data.
 *
 * One entry per service slug: `anchorTable`, `fearStats`, `lossStats`,
 * `crossSell`. Merged into the FocusedServicePage config by
 * GenericServicePage and AutoRepairNearMePage so the conversion-overhaul
 * sections render without polluting `shared/services.ts` (which is
 * business data, not marketing copy).
 *
 * Per docs/CONVERSION-OVERHAUL-V1.1.md: every claim in here is
 * defensible — sources cited where possible, prices are real, no
 * manufactured stats.
 *
 * Tone gradient guide:
 *   tone="danger"  = catastrophic / safety-of-life issue (brakes, transmission failure)
 *   tone="warning" = compounding damage (CEL, AC, emissions)
 *   tone="info"    = preventive / maintenance (oil, tires, alignment)
 */
import type { ServicePageConfig } from "@/components/FocusedServicePage";
import { Disc, Activity, Wrench, AlertTriangle, Clock, Snowflake, Thermometer, Battery, Zap, CheckCircle } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackEvent } from "@/components/SEO";

/** A subset of ServicePageConfig containing only the conversion fields.
 *  heroSecondaryCta / ctaHeadline / ctaSub are included so per-slug
 *  entries can override the operating-model CTAs (e.g. oil changes are
 *  sit-and-wait FCFS — no drop-off — so /oil-change swaps the hero
 *  SCHEDULE DROP-OFF for "CAN I COME NOW?"). */
export type ConversionFields = Pick<
  ServicePageConfig,
  | "anchorTable"
  | "fearStats"
  | "lossStats"
  | "crossSell"
  | "curiosityArc"
  | "heroSecondaryCta"
  | "heroTertiaryCta"
  | "pricingOverride"
  | "ctaHeadline"
  | "ctaSub"
>;

/**
 * Lookup the conversion data for a given service slug. Returns an empty
 * object when the slug isn't covered yet — calling code can spread it
 * safely into a config and the page renders unchanged.
 */
export function getConversionDataForSlug(slug: string): ConversionFields {
  return CONVERSION_DATA[slug] ?? {};
}

const CONVERSION_DATA: Record<string, ConversionFields> = {
  // ════════════════════════════════════════════════════════
  // OIL CHANGE — info tone (preventive)
  // ════════════════════════════════════════════════════════
  "oil-change": {
    // 2026-07-02 operator rule · oil changes are first-come, first-served
    // sit-and-wait — there is NO drop-off for this service. The generic
    // SCHEDULE DROP-OFF hero CTA was wrong here; "CAN I COME NOW?" jumps
    // to the #booking section, whose headline answers the question.
    heroSecondaryCta: { label: "CAN I COME NOW?", href: "#booking" },
    ctaHeadline: "CAN I COME NOW? YES — PULL UP.",
    ctaSub:
      "Oil changes are first-come, first-served. No appointment, no drop-off — pull up, have a seat, and most are done in about 15 minutes. Or send your info below and we'll text you back.",
    // Curiosity arc (2026-05-30) — oil change is the "cheaper than you think"
    // service; hero hook plays the pleasant-surprise gap (no $), stakes hook =
    // honest compounding cost the fear stats back up.
    curiosityArc: {
      heroHook: "Less than you'd guess.",
      stakesHook: "Skip it twice and the number changes — here's what old oil actually costs.",
    },
    anchorTable: {
      serviceName: "Synthetic oil change — Cleveland market quotes",
      rows: [
        { label: "Cleveland-area dealer", price: "$110" },
        { label: "Quick-lube chain (Jiffy / Valvoline)", price: "$89" },
        { label: "Nick's Tire & Auto", price: "From $80", ours: true },
      ],
      source: "Full synthetic from $80, conventional/blend from $49 (plus tax). Includes new filter + free multi-point check. Walk in or call for a live quote on your vehicle's oil spec.",
    },
    fearStats: {
      heading: "What skipping oil changes actually does to your engine.",
      stats: [
        {
          value: "$4,000",
          consequence: "Average engine rebuild when sludge from skipped oil changes seizes a piston ring or starves the timing chain. Two missed changes is the typical trigger point.",
          source: "AAA repair-cost benchmarks; engine-failure root-cause data.",
        },
        {
          value: "12%",
          unit: "MPG loss",
          consequence: "Old oil thickens and adds friction inside the engine. A 30-MPG car drops to ~26 MPG. On 1,000 miles/month, that's roughly $25 wasted at the pump every month — quietly.",
        },
        {
          value: "60K",
          unit: "miles",
          consequence: "Engines that get oil changes on schedule routinely outlast 200K miles. Engines that skip 2-3 cycles often need major work by 60K. Same engine, different ending — purely based on when the oil was changed.",
        },
      ],
    },
    lossStats: [
      {
        amount: 25,
        unit: "per month",
        label: "in extra fuel from old oil",
        reason: "Thick, contaminated oil increases internal friction. The engine fights itself — fuel economy quietly drops 8-12% before you notice. Fresh oil pays for itself in about 3 months at current Cleveland gas prices.",
        ctaHref: "#booking",
        ctaLabel: "COME IN TODAY",
      },
    ],
    crossSell: {
      heading: "While the car's on the lift — what else needs eyes on it?",
      items: [
        {
          tone: "warning",
          icon: <Activity className="w-5 h-5" />,
          symptom: "Check engine light flickered recently?",
          consequence: "Oil-change visit is the cheapest time to scan — we read the codes for free.",
          relief: "Free OBD-II scan, full diagnostic only if needed.",
          ctaLabel: "SCAN MY CAR",
          ctaHref: "/diagnostics",
        },
        {
          tone: "info",
          icon: <Disc className="w-5 h-5" />,
          symptom: "Tires looking worn or uneven?",
          consequence: "Tread depth check is included — we'll tell you if you have miles or weeks.",
          relief: "New & used tires installed during the oil change. Walk in or call for a live quote on your size.",
          ctaLabel: "CHECK TIRES",
          ctaHref: "/tires",
        },
        {
          tone: "info",
          icon: <Wrench className="w-5 h-5" />,
          symptom: "Brakes squealing on cold mornings?",
          consequence: "We'll measure pad thickness with the wheels off — takes 5 extra minutes.",
          relief: "Free brake inspection. Written estimate before any work.",
          ctaLabel: "BRAKE CHECK",
          ctaHref: "/brakes",
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════
  // EMISSIONS / OHIO E-CHECK — warning tone (compliance + cascade)
  // ════════════════════════════════════════════════════════
  emissions: {
    // Operator call (2026-07-04): NO repair prices on this page — dollar
    // ranges scare customers into price-shopping before we've seen the
    // car. The pricing-tier grid is replaced by a trust/approval block
    // (pricingOverride below). The anchorTable stays: it prices the
    // COMPETITORS high and us at "Free estimate" — anchoring, not pricing.
    // The quick scan is a pull-up service (like tires) — no drop-off, no
    // waiting room — hence the third hero button straight to Maps.
    heroTertiaryCta: {
      label: "COME GET A SCAN",
      href: BUSINESS.urls.googleMapsDirections,
      external: true,
    },
    pricingOverride: (
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="font-bold text-3xl sm:text-4xl text-foreground tracking-tight">
          THE MONEY PART? COME TALK TO US.
        </h2>
        <p className="text-foreground/70 mt-4 text-[15px] leading-relaxed">
          No price list here on purpose — a number on a website can&apos;t see
          your car, and every failure is different. Here&apos;s what we can
          tell you: payment programs get people approved here every week,
          including plenty of folks who came in thinking their credit was too
          far gone. No credit history needed to check, and checking
          doesn&apos;t ding your score. Come talk to us before you write the
          car off.
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          {[
            "Free readiness scan before the state test — pull up, no drop-off needed",
            "Written estimate before any wrench moves — you don't pay until you say yes",
            "Four payment providers compete for your approval — no hard credit pull to check",
            "If the repair costs more than the car is worth, we tell you straight",
          ].map((item) => (
            <div key={item} className="flex items-start gap-3 bg-card/40 border border-border/20 rounded px-4 py-3">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[13px] text-foreground/90">{item}</span>
            </div>
          ))}
        </div>
        <a
          href="/financing"
          onClick={() => trackEvent("emissions_payment_options_click", { source: "trust-block" })}
          className="inline-flex items-center justify-center mt-8 min-h-[44px] px-6 rounded-md bg-primary text-primary-foreground font-bold tracking-wide hover:opacity-90 transition-colors"
        >
          SEE PAYMENT OPTIONS
        </a>
      </div>
    ),
    anchorTable: {
      serviceName: "Ohio E-Check repair — Cleveland market quotes",
      rows: [
        { label: "Cleveland-area dealer (typical fail-fix)", price: "$650" },
        { label: "Independent chain", price: "$420" },
        { label: "Nick's (free readiness check + repair)", price: "Free estimate", ours: true },
      ],
      source: "Final price varies with the failure mode (O2 sensor / EVAP / catalytic). The state runs the official E-Check; we run a free readiness check, then fix the failure so you pass — no \"do it twice\" risk.",
    },
    fearStats: {
      heading: "What an E-Check failure actually costs if you let it slide.",
      stats: [
        {
          value: "30",
          unit: "days",
          consequence: "Ohio gives you 30 days from the fail notice to remedy + retest. Day 31 your registration becomes invalid — even if your tags say otherwise on paper.",
          source: "Ohio Bureau of Motor Vehicles E-Check program rules.",
        },
        {
          value: "$150+",
          unit: "per stop",
          consequence: "Driving with expired registration in Ohio: $150+ ticket per traffic stop, plus court costs. Two stops in 30 days = the cost of fixing the car twice over.",
        },
        {
          value: "Impound",
          unit: "risk",
          consequence: "Repeat expired-registration violations can result in vehicle impoundment in Cuyahoga County. Towing fee + daily storage + reinstatement fee compounds fast — typically $400-$800 to recover the car.",
        },
      ],
    },
    lossStats: [
      {
        amount: 10,
        unit: "per day",
        label: "in extra ticket-risk exposure once your tags expire",
        reason: "Insurance companies treat invalid registration as elevated risk on subsequent claims. The longer it sits expired, the higher the chance of a stop, ticket, court date, and a rate hike that lasts 3 years.",
        ctaHref: "#booking",
        ctaLabel: "GET LEGAL TODAY",
      },
    ],
    crossSell: {
      heading: "Failed for a specific reason? We fix it specifically.",
      items: [
        {
          tone: "warning",
          icon: <Activity className="w-5 h-5" />,
          symptom: "Code P0420 / P0430 (catalytic efficiency)?",
          consequence: "Could be a $200 sensor or a $1,500 catalytic converter — diagnostic decides which.",
          relief: "Free 5-min scan. Deeper diagnostic gets a written estimate, credited if we fix it.",
          ctaLabel: "DIAGNOSE FIRST",
          ctaHref: "/diagnostics",
        },
        {
          tone: "info",
          icon: <Wrench className="w-5 h-5" />,
          symptom: "Failed on \"readiness monitors not ready\"?",
          consequence: "Battery disconnect resets monitors — needs ~100 miles of mixed driving + fresh oil to complete.",
          relief: "We do the drive cycle + retest while you wait.",
          ctaLabel: "GET RETEST READY",
          ctaHref: "#booking",
        },
        {
          tone: "warning",
          icon: <AlertTriangle className="w-5 h-5" />,
          symptom: "EVAP system leak?",
          consequence: "Often as simple as a cracked gas cap. Sometimes a cracked vapor canister. Smoke test confirms.",
          relief: "Smoke test included with the full diagnostic. Free written estimate before any work.",
          ctaLabel: "TEST FOR LEAKS",
          ctaHref: "/diagnostics",
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════
  // AC REPAIR — warning tone (compounding cascade)
  // ════════════════════════════════════════════════════════
  "ac-repair": {
    anchorTable: {
      serviceName: "AC system service — Cleveland market quotes",
      rows: [
        { label: "Dealer AC diagnostic + recharge", price: "$295" },
        { label: "Chain shop AC service", price: "$195" },
        { label: "Nick's (free check)", price: "Free estimate", ours: true },
      ],
      source: "Free check + system pressure test. Refrigerant recharge, compressor / condenser / evaporator repairs all get a written estimate before any work.",
    },
    fearStats: {
      heading: "Why a weak AC today becomes a $1,400 AC tomorrow.",
      stats: [
        {
          value: "0.5–1 lb",
          unit: "leak per year",
          consequence: "Even a tiny refrigerant leak grows. By the second summer, the system runs starved — compressor cycles too fast, overheats, eats its own bearings.",
        },
        {
          value: "$1,400",
          consequence: "Average AC compressor replacement when a $40 recharge could have caught the leak two seasons earlier. Compressor + dryer + evac/recharge labor.",
          source: "AAA repair benchmarks; refrigerant leak progression data.",
        },
        {
          value: "90°F+",
          unit: "Cleveland summer day",
          consequence: "Cleveland hits 90°F+ regularly June–August. AC fails in heat. Repair waits average 3-5 days mid-summer at chain shops — at Nick's, walk-in same day if you book by 11 AM.",
        },
      ],
    },
    lossStats: [
      {
        amount: 1.5,
        unit: "per day in summer",
        label: "of compressor wear from running on low refrigerant",
        reason: "When refrigerant is low, the compressor short-cycles — it works harder for less cooling. Bearings wear out 3-5x faster than when fully charged. The longer you run it weak, the bigger the eventual bill.",
        ctaHref: "#booking",
        ctaLabel: "RECHARGE BEFORE IT FAILS",
      },
    ],
    crossSell: {
      heading: "Other things that fail when AC fails.",
      items: [
        {
          tone: "warning",
          icon: <Thermometer className="w-5 h-5" />,
          symptom: "Coolant temp running hot too?",
          consequence: "AC condenser blocks airflow when clogged — engine cooling suffers next.",
          relief: "Free cooling-system inspection with AC service.",
          ctaLabel: "COOLING SYSTEM",
          ctaHref: "/cooling",
        },
        {
          tone: "info",
          icon: <Battery className="w-5 h-5" />,
          symptom: "Battery weak when AC is on?",
          consequence: "AC compressor pulls hard amperage — exposes a marginal battery first.",
          relief: "Free battery + alternator test. Free written estimate before any replacement.",
          ctaLabel: "BATTERY TEST",
          ctaHref: "/battery",
        },
        {
          tone: "info",
          icon: <Wrench className="w-5 h-5" />,
          symptom: "Belt squeal when AC engages?",
          consequence: "Worn serpentine belt — AC clutch acts as the canary.",
          relief: "Belt replacement with full accessory inspection. Free written estimate first.",
          ctaLabel: "BELT INSPECTION",
          ctaHref: "/belts-hoses",
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════
  // TRANSMISSION — danger tone (catastrophic if ignored)
  // ════════════════════════════════════════════════════════
  transmission: {
    anchorTable: {
      serviceName: "Transmission service — Cleveland market quotes",
      rows: [
        { label: "Dealer fluid + filter service", price: "$320" },
        { label: "Chain shop fluid flush", price: "$185" },
        { label: "Nick's (full fluid + filter)", price: "Free estimate", ours: true },
      ],
      source: "Major repairs (rebuild / replacement) priced after diagnostic. Most failed-shift complaints fix with fluid + filter or solenoid replacement, NOT a full rebuild — unless someone else delayed too long.",
    },
    fearStats: {
      heading: "Slipping transmission isn't a \"deal with it later\" problem.",
      stats: [
        {
          value: "$3,500–$5,500",
          consequence: "Average transmission rebuild on a typical Cleveland-fleet sedan or SUV. Replacement units run $5,500-$8,000 depending on year/make.",
          source: "Independent transmission shop benchmarks, Cleveland metro 2026.",
        },
        {
          value: "30–60",
          unit: "miles",
          consequence: "Of slipping under load before the clutch packs glaze permanently. Once they glaze, you can't recover with fluid — even a flush won't bring it back. The window from \"caught early\" to \"needs rebuild\" is shorter than people think.",
        },
        {
          value: "40×",
          unit: "fluid service vs full rebuild",
          consequence: "Stark math: a fluid + filter service catches solenoid failures and pressure-control issues before they wreck internal hard parts. The cost gap between catching it now and rebuilding later is roughly 40-fold. Almost every \"surprise transmission failure\" started life as a slip + delay.",
        },
      ],
    },
    lossStats: [
      {
        amount: 50,
        unit: "per day",
        label: "of compounding clutch-pack wear",
        reason: "A slipping transmission damages itself faster every mile under load. Clutch material flakes off into the fluid; the fluid loses friction modifiers; the slip gets worse; the clutch packs glaze. The longer you wait, the closer you get to a rebuild.",
        ctaHref: "#booking",
        ctaLabel: "DIAGNOSE TODAY",
      },
    ],
    crossSell: {
      heading: "If your transmission is slipping, check these too.",
      items: [
        {
          tone: "warning",
          icon: <Activity className="w-5 h-5" />,
          symptom: "Check engine light came on with the slip?",
          consequence: "Transmission control module (TCM) faults trigger CEL — diagnostic narrows it fast.",
          relief: "Free 5-min scan. Deeper diagnostic gets a written estimate, credited if we fix it.",
          ctaLabel: "DIAGNOSE",
          ctaHref: "/diagnostics",
        },
        {
          tone: "info",
          icon: <Thermometer className="w-5 h-5" />,
          symptom: "Coolant temp also high?",
          consequence: "Auto transmissions share a cooler with the radiator — radiator failure can mix coolant into trans fluid.",
          relief: "Coolant + trans fluid inspection — checks for cross-contamination.",
          ctaLabel: "CHECK COOLING",
          ctaHref: "/cooling",
        },
        {
          tone: "info",
          icon: <Wrench className="w-5 h-5" />,
          symptom: "Hard shifts only when cold?",
          consequence: "Often a sticky shift solenoid — much cheaper than a slip under load.",
          relief: "Solenoid + valve-body inspection during fluid service.",
          ctaLabel: "BOOK SERVICE",
          ctaHref: "#booking",
        },
      ],
    },
  },
};
