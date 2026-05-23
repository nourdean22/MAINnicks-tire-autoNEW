/**
 * Pure derivation from a `ProviderHealthSnapshot` → the props the
 * <ComparisonMatrix> needs. Lives next to the page rather than in
 * /lib because nothing else consumes it · co-locating keeps the page
 * file from drifting from its derivation logic.
 *
 * Separating this from the page exists for ONE reason: testability.
 * Rendering the page through `trpc.useQuery` in vitest's jsdom needs a
 * React Query + tRPC provider tree, a Next.js link mock, etc. — way too
 * much surface for what's really being asserted (the column count, the
 * tier mapping, the inverted scoring on latency/errors/cooldown). The
 * pure helper takes a fixture snapshot and returns plain data · the
 * test asserts data shape, not rendered HTML.
 *
 * Column choices (locked):
 *   · status   higher-is-better via score (1 for online · 0 for down)
 *   · latency  lower-is-better (avg ms over last hour)
 *   · errors   lower-is-better (count over last hour)
 *   · cooldown lower-is-better (quota-breaker remaining seconds)
 *   · tier     informational only · no `score` → neutral tint
 */

import type {
  MatrixCell,
  MatrixCriterion,
  MatrixOption,
} from "@/components/ui/comparison-matrix";
import type { ProviderHealthSnapshot } from "@/lib/ai/provider-health";

export type ProviderName =
  ProviderHealthSnapshot["providers"][number]["name"];

/**
 * Provider tier labels. "primary" = first lane the chat tries
 * (venice + ollama · co-1st per the ai-policy doc), "fallback" = the
 * paid OpenAI/Anthropic lanes that only fire when both primaries are
 * exhausted, "emergency" = the last-ditch lane gated by an explicit
 * feature flag. Informational · the matrix doesn't tint this column.
 */
export const PROVIDER_TIER: Record<ProviderName, string> = {
  venice: "primary",
  ollama: "primary",
  openai: "fallback",
  anthropic: "fallback",
  emergency: "emergency",
};

export const PROVIDER_MATRIX_CRITERIA: ReadonlyArray<MatrixCriterion> = [
  { id: "status", label: "status", higherIsBetter: true },
  { id: "latency", label: "avg latency (ms)", higherIsBetter: false },
  { id: "errors", label: "recent errors", higherIsBetter: false },
  { id: "cooldown", label: "cooldown (s)", higherIsBetter: false },
  { id: "tier", label: "tier" },
];

/**
 * Per-provider matrix option · ID is the provider name (stable). Extra
 * fields tunnel the raw snapshot row through so the cell resolver can
 * read everything without a second lookup.
 */
export interface ProviderMatrixOption extends MatrixOption {
  _available: boolean;
  _modelId: string;
  _avgLatencyMs: number;
  _recentErrors: number;
  _quotaCooldownRemainingMs: number;
  _tier: string;
}

export function buildProviderMatrixOptions(
  snapshot: ProviderHealthSnapshot,
): ProviderMatrixOption[] {
  return snapshot.providers.map((p) => ({
    id: p.name,
    // Show the provider name + model id beneath in one line · readable on
    // narrow screens where the dense table is the priority. Capitalize
    // the first letter, leave the rest lowercase to match the editorial
    // tone (no SHOUTING).
    label: `${p.name[0].toUpperCase()}${p.name.slice(1)} · ${p.modelId}`,
    _available: p.available,
    _modelId: p.modelId,
    _avgLatencyMs: p.avgLatencyMs,
    _recentErrors: p.recentErrors,
    _quotaCooldownRemainingMs: p.quotaCooldownRemainingMs,
    _tier: PROVIDER_TIER[p.name] ?? "unknown",
  }));
}

export function resolveProviderMatrixCell(
  option: MatrixOption,
  criterion: MatrixCriterion,
): MatrixCell {
  const o = option as ProviderMatrixOption;
  switch (criterion.id) {
    case "status":
      return {
        value: o._available ? "online" : "down",
        score: o._available ? 1 : 0,
        display: o._available ? "online" : "down",
      };
    case "latency": {
      // Latency 0 means "no calls in the last hour" · render as "—" so it
      // doesn't get tinted as the winner just for being silent. Null
      // value bypasses scoring (ComparisonMatrix treats it as neutral).
      if (o._avgLatencyMs <= 0) return { value: null, display: "—" };
      return {
        value: o._avgLatencyMs,
        score: o._avgLatencyMs,
        display: `${Math.round(o._avgLatencyMs)}`,
      };
    }
    case "errors":
      return {
        value: o._recentErrors,
        score: o._recentErrors,
        display: `${o._recentErrors}`,
      };
    case "cooldown": {
      const sec = Math.round(o._quotaCooldownRemainingMs / 1000);
      return {
        value: sec,
        score: sec,
        display: sec === 0 ? "0" : `${sec}`,
      };
    }
    case "tier":
      // No `score` · ComparisonMatrix will assign neutral tint across the
      // whole column. Informational dimension.
      return { value: o._tier, display: o._tier };
    default:
      return { value: null };
  }
}
