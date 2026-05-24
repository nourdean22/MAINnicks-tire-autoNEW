# @statenour/lenses

> Strategic reasoning lenses for AI agents — a typed registry of **49 frameworks**
> (first-principles, JTBD, Porter's five forces, inversion, north-star metric,
> Pareto, OODA loop, lean canvas, …) with trigger regexes and ready-to-inject
> prompt blocks. Drop in next to your system prompt and let the model pick the
> right lens.

[![npm version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://npmjs.com/package/@statenour/lenses)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![types](https://img.shields.io/badge/types-included-blue.svg)](src/types.ts)

## Why this exists

LLMs are good at producing answers. They're worse at picking the right
**lens** to look at a question. Ask GPT-4o "should I raise prices?" and you
get a generic mix of demand elasticity, anchoring bias, and competitive
positioning — all mushed together, no single framework reasoned through.

This package gives your agent a typed registry of 49 strategic lenses, each
with:

- a one-line headline
- a set of regex triggers (so a detector can find the right lens for any
  question)
- anti-triggers (so "north star" doesn't fire on astronomy questions)
- a system-prompt block telling the model **how to reason through this lens**

Plug it into your system prompt builder, run the detector against the user
message, inject the top 1-3 lenses, and the model now reasons through one
specific framework instead of a hot-take that sounds strategic.

## Quick start

```bash
npm install @statenour/lenses
```

```typescript
import { REGISTRY, detectLenses, formatLensBlock } from "@statenour/lenses";

const userMessage = "should I 10x the price or stay competitive?";
const matches = detectLenses(userMessage, { topN: 3 });
// → [elon-musk, pricing-strategy, opportunity-cost]

const promptBlock = formatLensBlock(matches);
// → "## STRATEGIC LENS\n\nApply the Elon Musk lens...\n\n..."

// Inject `promptBlock` into your system prompt.
```

## What's in the registry (v0.1.0)

49 frameworks across:

- **First principles + physics** — elon-musk, inversion, second-order-thinking,
  five-whys, opportunity-cost, hanlon's-razor
- **Strategy + competition** — porter's-five-forces, blue-ocean,
  competitive-landscape, marketplace-dynamics, innovator's-dilemma, power-law
- **Customer + product** — jobs-to-be-done, ideal-customer-profile,
  crossing-the-chasm, awareness-stages, pricing-strategy, pricing-power,
  lean-canvas, osterwalder-canvas
- **Growth + metrics** — aarrr-metrics, north-star-metric, startup-metrics,
  growth-engine, cohort-analysis, launch-strategy
- **Money + finance** — financial-modeling, financial-projections,
  unit-economics, capital-allocation, monetization, market-opportunity
- **Decision + operations** — okrs, kotler-macro, ooda-loop,
  pareto-principle, negotiation, loss-aversion

See [src/frameworks/](src/frameworks/) for the full list.

## API

### `REGISTRY: StrategicFramework[]`

All 49 lenses as a flat array. Iterate or filter as needed.

### `detectLenses(message: string, opts?: { topN?: number }): FrameworkMatch[]`

Run the registry's trigger regexes against `message`. Returns the top-N
matches (default 3) by score, with anti-trigger suppression.

### `formatLensBlock(matches: FrameworkMatch[]): string`

Compose the matched lenses into a single system-prompt section. Drop this
into your system prompt under any heading you like.

### `StrategicFramework` (type)

```typescript
interface StrategicFramework {
  id: string;            // stable id · snake-case
  name: string;          // display name
  oneLiner: string;      // 1-line summary
  triggers: RegExp[];    // positive match patterns
  antiTriggers?: RegExp[]; // suppress on these
  lens: string;          // reasoning prompt block
  weight?: number;       // confidence multiplier · default 1.0
  featured?: boolean;    // mark for compact-fallback lists
}
```

## Adding your own lens

Lenses are pure data — extend the registry without forking:

```typescript
import { REGISTRY, type StrategicFramework } from "@statenour/lenses";

const myLens: StrategicFramework = {
  id: "my-lens",
  name: "My Custom Lens",
  oneLiner: "...",
  triggers: [/\bmy keyword\b/i],
  lens: `Apply My Lens. Step 1 · ... Step 2 · ...`,
};

const extended = [...REGISTRY, myLens];
```

Pull requests with new lenses welcome — see [CONTRIBUTING.md](#contributing).

## Provenance

This package was extracted from [statenour-os](https://autonicks.com), an
operator's personal OS. The lenses were honed against ~14 months of live
operator chat data — every trigger has fired on a real question, every
prompt block has been judged against an LLM critic for hallucination resistance.

Some lens names (Elon Musk, Steve Jobs, Warren Buffett, Charlie Munger) are
inspired by real-person thinking. The lenses themselves are **distilled
patterns**, not the person's words. They reason **like** the person, not
**as** the person.

## Contributing

This is an active extraction. v0.1.0 = "carve out what works, expose what's
stable." Future versions will:

- Add lens fire-rate telemetry hooks (`onLensFired` callback)
- Add state-conditioned eligibility (`eligibleFor(state)` predicate)
- Expand to ~80 frameworks (mental models from Munger, decision theory,
  game theory, behavioral finance)

PRs welcome via the [statenour-os monorepo](https://github.com/nourdean22/MAINnicks-tire-autoNEW)
under `packages/lenses/`.

## License

MIT · see [LICENSE](LICENSE).
