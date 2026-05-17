import type { StrategicFramework } from "../types";

/**
 * Wardley Mapping (Simon Wardley) — situational awareness for
 * strategy. Map components by user need + evolutionary stage
 * (genesis · custom · product · commodity). Where on the map you
 * play determines what tactics work.
 */
export const wardleyMapping: StrategicFramework = {
  id: "wardley-mapping",
  name: "Wardley Mapping (situational awareness)",
  oneLiner: "Map components by user need + evolution stage · genesis → custom → product → commodity. Position determines tactics.",
  triggers: [
    /\bwardley\s+(mapping|map)\b|\bsimon\s+wardley\b/i,
    /\b(situational\s+awareness|landscape\s+map)\b/i,
    /\b(value\s+chain\s+(map|analysis))\b/i,
    /\b(genesis|custom\s+built|product|commodity)\s+(stage|phase|component)/i,
    /\b(build\s+vs\s+buy|outsource\s+vs\s+in[\s-]?house)\b/i,
    /\b(component\s+evolution|technology\s+evolution)/i,
    /\b(where\s+(should|do)\s+we\s+(invest|build|differentiate))/i,
  ],
  weight: 0.95,
  lens: `Apply Wardley Mapping. The premise · most strategy fails because
the team has no shared picture of the LANDSCAPE. They argue tactics
without agreeing on where they are. A Wardley map fixes that.

Two axes ·

  · Y-axis · USER NEED · the customer's anchor at the top, then the
    components needed to deliver that need stacked below. Components
    closer to the user are more visible/valuable; components below are
    enabling infrastructure.

  · X-axis · EVOLUTION STAGE · every component lives somewhere on a
    4-stage curve:
      1. GENESIS · novel · uncertain · expensive · custom · IP
      2. CUSTOM-BUILT · still bespoke · proven the concept works
      3. PRODUCT · standardized offerings · multiple vendors
      4. COMMODITY / UTILITY · undifferentiated · price-driven

Tactics that work depend on where the component sits ·

  · GENESIS components · invest in experimentation · accept high
    failure rate · this is where new IP is born
  · PRODUCT components · operational excellence · feature-set ·
    customer service · this is where most businesses live
  · COMMODITY components · OUTSOURCE · don't waste differentiated
    talent on undifferentiated work · cloud infra is the canonical
    example (don't build your own data center for a SaaS startup)

Strategic moves cluster around two questions ·
  (a) what's evolving from product → commodity that we should
      stop investing in and outsource?
  (b) what's evolving from custom → product where we could build
      ahead of the curve?

For Nick · tire installation is product / commodity (don't try to
"differentiate the wheel-balancer machine"). Customer relationship
+ trust + diagnostic insight are still custom-built · that's where
the differentiation lives.

Surface · the map's components · which evolution stage each is in ·
where the strategic moves are.`,
};
