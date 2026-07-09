# Signal Forge Architecture Fit

## Monorepo Placement
`@nour/signal-forge` is a pure, independent package located at `packages/signal-forge`. 

### Why is it not part of other packages?
- **Not in `social-assets` / `reel-engine` / `gbp-publisher`:** Those packages explicitly deal with social media platform abstractions, rendering layers, or GBP API logic. Signal Forge is fundamentally a system for execution architectures and forensic audits, which are not platform-specific.
- **Not in `apps/nickstire` / `apps/statenour`:** Signal Forge is designed to be consumed by *both* Nick's Tire (for Meta Campaign planning workflows) and Statenour (for internal QA/RAG reviews). Tying it to a specific app creates circular dependency risks.
- **Not in `ai-capabilities`:** `ai-capabilities` was deemed too narrow and potentially overloaded. Signal Forge is a specific "prompt-product" framework with strict structural scaffolding.

## Future Integrations
Signal Forge V1 is package-first, with strict schemas, CLI offline tests, and deterministic synthetic examples. It does NOT create database tables or large UI dashboards.

In future iterations, Signal Forge can integrate into:
1. **Nick's Tire Meta Campaign Planner:** Using `Signal Control Forge` to dynamically allocate single or multi-agent workflows based on ad complexity.
2. **Growth UI:** An admin-only TRPC endpoint can invoke `generateSignalControlArchitecture` to display execution plans before executing paid ad spends.
3. **Statenour QA RAG:** `SignalForge Nexus` can run batch audits on Statenour's support tickets, utilizing the strict `DEFECT_MAP` to highlight hallucination risks.

## Safety & Compliance
- **No Private Scraping:** Control Forge explicitly outputs forbidden boundaries against private scraping or fabricating metrics.
- **Fake Certainty Protection:** Nexus utilizes markers like `unverifiable` and `structural risk` instead of hallucinating support when evidence is missing.
- **No App Leaks:** A strict package boundary test ensures `packages/signal-forge` never imports `apps/*` files, guaranteeing environmental purity.
