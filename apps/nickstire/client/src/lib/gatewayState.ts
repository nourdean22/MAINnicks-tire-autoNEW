/**
 * gatewayState — one reading of `sms.gatewayHealth` for every admin surface.
 *
 * Q-23 phase 9 gave the resolver an additive `readable` field: false when the
 * Capevace API did not answer, so the phone's state is UNKNOWN. Reading
 * `online` alone turns that into "offline" and blames a phone nobody could ask
 * about. GatewayPill and the Data freshness card already split the two; this is
 * the same rule for the remaining readers (Q-23 phase 10).
 *
 * "unknown"  · our query failed with nothing cached, or the vendor API did not answer.
 * "checking" · the first read is still in flight. No claim either way.
 * "offline"  · the API answered and the phone has not checked in recently.
 */

export type GatewayState = "online" | "offline" | "unknown" | "not_configured" | "checking";

/** The slice of the `sms.gatewayHealth` payload this reads. */
export interface GatewayHealthLike {
  configured?: boolean;
  online?: boolean;
  /** false when the vendor API could not be asked; true or absent otherwise. */
  readable?: boolean;
}

export function gatewayState(data: GatewayHealthLike | null | undefined, isError = false): GatewayState {
  // A failed query with nothing cached is unknown. With cached data, trust it:
  // react-query flags a failed BACKGROUND refetch as an error while keeping the
  // last good read, and refetchOnWindowFocus is on, so "isError alone" would
  // flip a fine brief to unknown every time the operator tabs back (the same
  // rule OutreachBrief applies to its other queries).
  if (!data) return isError ? "unknown" : "checking";
  if (data.configured === false) return "not_configured";
  if (data.readable === false) return "unknown";
  return data.online ? "online" : "offline";
}
