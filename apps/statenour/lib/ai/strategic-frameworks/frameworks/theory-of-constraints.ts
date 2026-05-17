import type { StrategicFramework } from "../types";

/**
 * Theory of Constraints (Goldratt) — the system is paced by its
 * single biggest bottleneck. Optimizing anything else is waste.
 * Find it · exploit it · subordinate everything else · elevate it ·
 * repeat.
 */
export const theoryOfConstraints: StrategicFramework = {
  id: "theory-of-constraints",
  name: "Theory of Constraints (Goldratt)",
  oneLiner: "Throughput = capacity of the BOTTLENECK. Improving anything else is waste. Find it · exploit it · subordinate · elevate · repeat.",
  triggers: [
    /\b(bottleneck|constraint|chokepoint|limiting\s+factor)\b/i,
    /\b(theory\s+of\s+constraints|toc|goldratt|the\s+goal)\b/i,
    /\b(throughput|cycle\s+time|lead\s+time|takt\s+time)\b/i,
    /\b(why\s+(can't|aren't)\s+we\s+(scaling|shipping|going)\s+faster)/i,
    /\b(where\s+is\s+the\s+(real\s+)?(problem|holdup|delay|slowdown))/i,
    /\b(capacity\s+(constraint|limit|ceiling))/i,
    /\b(work\s+in\s+progress|wip)\b/i,
    /\b(fix\s+the\s+(real|right)\s+(problem|thing))\b/i,
  ],
  antiTriggers: [
    // physical bottleneck · wine bottle / canyon / road / river
    /\b(wine\s+)?bottle\s+bottleneck\b/i,
    /\bbottleneck\s+of\s+(my|the)\s+(wine\s+)?bottle\b/i,
    /\b(canyon|valley|highway|road|traffic|river|gorge)\s+(bottleneck|narrows?)\b/i,
    /\bnarrows?\s+into\s+(a\s+)?(real\s+)?bottleneck\b/i,
  ],
  weight: 1.05,
  lens: `Apply Theory of Constraints. Every system has ONE constraint
limiting throughput at any moment · improving anything upstream
or downstream of it produces zero throughput improvement (and
often makes things worse · more WIP, more chaos).

The 5 focusing steps:

  1. IDENTIFY the constraint · where does work pile up · who's the
     bottleneck person/station/process? In a tire shop · usually the
     lift · or a single tech · or the parts-arrival window.

  2. EXPLOIT the constraint · squeeze MAX output from it without
     spending money. Don't waste a single minute of bottleneck time
     on rework, chitchat, or low-value work. Pre-stage parts, batch
     similar jobs, kill interruptions during bottleneck hours.

  3. SUBORDINATE everything else to the constraint · upstream stations
     should NOT run faster than the bottleneck (just builds WIP).
     Downstream stations should always have buffer ready to catch the
     constraint's output.

  4. ELEVATE the constraint · only AFTER steps 2-3 are exhausted ·
     spend money to add capacity (second lift · second tech).

  5. REPEAT · the constraint moves once you elevate the old one ·
     find the new one · go back to step 1.

The fatal mistake operators make · skipping to step 4 (buy more
capacity) before steps 2-3 (use what you have better). Most shops
have 30-50% latent capacity locked up in bottleneck waste.

Surface · what's the constraint right now · is it being exploited
or wasted · what's the cheapest move that adds throughput.`,
};
