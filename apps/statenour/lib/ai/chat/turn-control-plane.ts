/**
 * Turn control-plane primitives.
 *
 * This module is deliberately pure. It does not choose tools and it does not
 * authorize actions. It turns the tool-selection stages that already exist
 * into one explicit, inspectable per-turn capability plan so telemetry can
 * distinguish:
 *
 *   registered -> initially selected -> force-added -> stripped -> surfaced
 *
 * A model saying "that tool was not attached" is not evidence. This object is.
 */

export interface CapabilityPlanInput {
  traceId?: string;
  mode: string;
  registered: string[];
  initiallySelected: string[];
  surfaced: string[];
  disabled?: string[];
  alwaysOn?: string[];
  forced?: Record<string, string[]>;
  stripped?: string[];
  semanticReady: boolean;
}

export interface CapabilityPlan {
  traceId: string | null;
  mode: string;
  semanticReady: boolean;
  counts: {
    registered: number;
    initiallySelected: number;
    surfaced: number;
    disabled: number;
    stripped: number;
  };
  registered: string[];
  initiallySelected: string[];
  surfaced: string[];
  disabled: string[];
  alwaysOn: string[];
  forced: Record<string, string[]>;
  stripped: string[];
  recoveryLaneAvailable: boolean;
}

function uniqSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].filter(Boolean).sort();
}

function normalizeForced(
  forced: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [reason, names] of Object.entries(forced ?? {})) {
    const normalized = uniqSorted(names);
    if (normalized.length > 0) out[reason] = normalized;
  }
  return out;
}

export function buildCapabilityPlan(input: CapabilityPlanInput): CapabilityPlan {
  const registered = uniqSorted(input.registered);
  const initiallySelected = uniqSorted(input.initiallySelected);
  const surfaced = uniqSorted(input.surfaced);
  const disabled = uniqSorted(input.disabled);
  const alwaysOn = uniqSorted(input.alwaysOn);
  const stripped = uniqSorted(input.stripped);
  const forced = normalizeForced(input.forced);

  return {
    traceId: input.traceId ?? null,
    mode: input.mode,
    semanticReady: input.semanticReady,
    counts: {
      registered: registered.length,
      initiallySelected: initiallySelected.length,
      surfaced: surfaced.length,
      disabled: disabled.length,
      stripped: stripped.length,
    },
    registered,
    initiallySelected,
    surfaced,
    disabled,
    alwaysOn,
    forced,
    stripped,
    recoveryLaneAvailable:
      surfaced.includes("searchTools") && surfaced.includes("invokeTool"),
  };
}
