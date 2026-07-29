/**
 * features/chat-v2/lib/capability-label.ts — what the chat header badge
 * is allowed to CLAIM (2026-07-29).
 *
 * Reported defect: the badge read "FALLBACK ACTIVE" on a healthy app.
 * The tone line was
 *
 *   providers.data?.overallTone ?? (providers.isError ? "red" : "amber")
 *
 * so while the provider-health query was still LOADING — no data, no
 * error — the tone defaulted to amber, whose label is "fallback active".
 * The badge therefore asserted a specific provider failure on every page
 * load, before anything had been measured.
 *
 * That is a sharper version of the failure mode this codebase already
 * guards against elsewhere ("unknown is never green"): here unknown was
 * not merely painted green-or-not, it was rendered as a DIFFERENT
 * definite claim. A cautious style is right; a fabricated diagnosis is
 * not. Unknown now stays cautious in appearance and says "checking" in
 * words.
 *
 * Pure — no React, no queries — so the decision is testable on its own.
 */

export type ProviderTone = "green" | "amber" | "red";
export type ConnectionState = "online" | "degraded" | "offline";

export interface CapabilityInputs {
  connection: ConnectionState;
  /** Undefined while the provider-health query is in flight. */
  providerTone: ProviderTone | undefined;
  providerErrored: boolean;
  toolSummary?: { totalTools: number; degraded: number; down: number };
}

export interface CapabilityBadge {
  label: string;
  /** True = render the cautious (amber) treatment. Unknown counts as
   *  cautious: never claim health that has not been measured. */
  cautious: boolean;
  /** True only when nothing is actually known yet — lets the caller
   *  pick a neutral icon instead of a warning triangle. */
  unknown: boolean;
}

export function capabilityBadge(input: CapabilityInputs): CapabilityBadge {
  const { connection, providerTone, providerErrored, toolSummary } = input;

  // Offline is observed by the client itself — it needs no server data.
  if (connection === "offline") {
    return { label: "chat offline", cautious: true, unknown: false };
  }
  if (providerErrored) {
    return { label: "AI health unknown", cautious: true, unknown: true };
  }
  // Still loading: cautious styling, but NO diagnosis.
  if (!providerTone) {
    return { label: "checking capabilities", cautious: true, unknown: true };
  }
  if (providerTone === "red") {
    return { label: "AI offline", cautious: true, unknown: false };
  }
  if (providerTone === "amber") {
    return { label: "fallback active", cautious: true, unknown: false };
  }

  const toolsDegraded = Boolean(toolSummary && (toolSummary.degraded > 0 || toolSummary.down > 0));
  if (connection !== "online" || toolsDegraded) {
    return {
      label: toolSummary ? `${toolSummary.totalTools} tools ready` : "checking capabilities",
      cautious: true,
      unknown: !toolSummary,
    };
  }
  return {
    label: toolSummary ? `${toolSummary.totalTools} tools ready` : "checking capabilities",
    cautious: !toolSummary,
    unknown: !toolSummary,
  };
}
