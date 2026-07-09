# Meta Ads Campaign Architect

A production-ready internal package for generating highly compliant, structured Meta Ads campaign plans. It uses Zod schemas to enforce an exact 13-section output format, and a Compliance Scanner to strip out restricted language (e.g. personal attributes, false guarantees, unregulated health/automotive claims).

## Architecture

This package uses a **hybrid deterministic + LLM** architecture:
- **Sections 0-6 (Strategy, Architecture, Budgets):** Generated deterministically using hardcoded best-practice formulas.
- **Sections 7-10 (Ad Copy, Hooks, Reels, Landing Pages):** Generated via an injected `llmProvider` (using OpenAI/Gemini) if provided, falling back to basic deterministic generation if absent.

## Usage in App

```typescript
import { generateCampaignPlan, NicksTirePreset } from "@nour/meta-ads-architect";

// Inject the LLM adapter (e.g., from apps/nickstire/server/_core/llm)
const llmProvider = async (prompt, systemPrompt) => {
  return await myLlmClient.invoke(prompt, systemPrompt);
};

const plan = await generateCampaignPlan(NicksTirePreset, llmProvider);
```

## CLI Usage

You can test the deterministic core locally using the CLI:
```bash
pnpm --filter @nour/meta-ads-architect run check
tsx src/cli.ts --preset nicks-tire --out ./tmp/plan.json
```

## Compliance Engine

The engine scans all copy prior to finalizing the plan. It flags:
- Personal attribute language (e.g., "Your brakes are bad")
- Guarantee and instant claims ("100% Guaranteed", "Overnight")
- Prohibited regulated categories
