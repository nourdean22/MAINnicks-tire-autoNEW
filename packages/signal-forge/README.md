# @nour/signal-forge

Signal Forge is a unified prompt-product framework containing two architectural engines:

1. **Signal Control Forge:** Generates strict execution architectures from complex user requests (single-agent, tool-assisted, or multi-agent workflows).
2. **SignalForge Nexus:** A forensic evidence-led audit engine for evaluating LLM agents, RAG systems, and tool workflows.

## Why are these combined?

They share the same core underlying infrastructure:
- **Locked-Core Utilities:** `{LOCKED}` structural templates vs `[EDITABLE]` fields.
- **Evidence Ledgers:** Strict schemas ensuring every claim is backed by sources.
- **Structured Exporters:** Exact 19-section (Control) and 11-section (Nexus) Markdown rendering formats.

## Usage

You can use the package programmatically via its subpath exports:

\`\`\`typescript
import { generateSignalControlArchitecture } from "@nour/signal-forge/control";
import { generateNexusAudit } from "@nour/signal-forge/nexus";
import { assertLockedCoreUnchanged, rewriteEditableFieldsOnly } from "@nour/signal-forge/lock";

// Example
const input = createEcommerceTrendDiscoveryExample();
const output = generateSignalControlArchitecture(input);
\`\`\`

## CLI Examples

The package includes a dependency-light CLI capable of running synthetic, deterministic examples offline:

**Control Forge (Ecommerce Example)**
\`\`\`bash
pnpm --filter @nour/signal-forge control generate --example ecommerce-trends --out ./tmp/signal-control-forge-ecommerce.md
\`\`\`

**Nexus Audit (Enterprise RAG Example)**
\`\`\`bash
pnpm --filter @nour/signal-forge nexus audit --example enterprise-rag-support --out ./tmp/signalforge-nexus-rag-audit.md
\`\`\`

**Locked Core Validation**
\`\`\`bash
pnpm --filter @nour/signal-forge lock validate --original ./prompt-original.txt --modified ./prompt-modified.txt
\`\`\`

## LLM Provider Injection

Signal Forge is entirely LLM-agnostic. To use an LLM, inject the `LlmProvider` object when invoking real workflows (Note: V1 CLI examples run deterministic scaffolding).

\`\`\`typescript
import type { LlmProvider } from "@nour/signal-forge/lock";

const provider: LlmProvider = {
  invoke: async (req) => {
    // Implement using openai, anthropic, or custom fetch
    return {};
  }
}
\`\`\`

## Development & Tests

\`\`\`bash
pnpm --filter @nour/signal-forge test
pnpm --filter @nour/signal-forge build
\`\`\`
