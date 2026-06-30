/**
 * lib/ai/agents/types.ts · Task #13 · specialist sub-agent layer.
 *
 * Shared types for the router + specialists pattern. The router
 * classifies an incoming message and dispatches to either:
 *   · general           · the existing Nick chat path (unchanged)
 *   · financial-analyst · net-worth · savings · spending · money flow
 *   · decision-coach    · trade-offs · past-Nour patterns · grading
 *   · schedule-keeper   · calendar shape · day rhythm · reschedules
 *
 * The whole layer is GATED behind ENABLE_SPECIALIST_ROUTING. When the
 * env var is anything other than "true" the router always returns
 * { route: "general", reason: "routing-disabled", confidence: 1 } and
 * no specialist ever fires. Default behavior unchanged.
 *
 * See docs/agents/specialists.md for the operator-facing description
 * + how to add a new specialist.
 */

/** Stable route identifiers. Add a new value here when adding a specialist. */
export type SpecialistRoute =
  | "general"
  | "financial-analyst"
  | "decision-coach"
  | "schedule-keeper"
  | "marketing-director";

export interface RoutingDecision {
  /** Which specialist (or general Nick) should handle this turn. */
  route: SpecialistRoute;
  /** Short, human-readable reason · surfaced in logs + agent traces. */
  reason: string;
  /** 0..1 · the router's confidence in this route. */
  confidence: number;
}

/** Input shape shared by routeMessage() and every runSpecialist(). */
export interface SpecialistInput {
  /**
   * Conversation history. The router classifies the LATEST user
   * message (last "user" role entry); specialists see the full
   * history for context.
   */
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /**
   * Optional context fragments the dispatcher passes through ·
   * pre-warmed brain blobs · tier hints · etc. Specialists may
   * ignore.
   */
  contextHints?: Record<string, unknown>;
}

export interface SpecialistResponse {
  /** Visible reply text · already stripped of any [[HANDBACK: ...]] marker. */
  content: string;
  /**
   * When true, the dispatcher should hand back to general Nick.
   * Specialists set this when they detect the user's message has
   * drifted out of their domain mid-conversation (e.g. user
   * switches from net-worth to a personal-routine question).
   */
  handBack?: boolean;
  /** Operator-readable explanation for hand-back · logged into traces. */
  reason?: string;
  /** Names of tools the specialist consulted · empty until tool wiring lands. */
  toolsUsed?: string[];
  /** Which provider actually served the turn · pulled from aiChat result. */
  provider?: string;
}

/** True when the specialist routing layer is enabled at the env level. */
export function isSpecialistRoutingEnabled(): boolean {
  return process.env.ENABLE_SPECIALIST_ROUTING === "true";
}

/**
 * The hand-back sentinel · specialists are instructed in their
 * system prompt to append this on a line by itself when they
 * realize the message is out of their domain. The dispatcher
 * (and tests) strip it before returning content to the caller.
 */
export const HANDBACK_MARKER_RE = /\[\[HANDBACK:\s*([^\]]*?)\]\]\s*$/m;

/**
 * Strip the hand-back marker from a raw model reply and return
 * { content, handBack, reason }. Pure · no I/O.
 */
export function extractHandBack(raw: string): {
  content: string;
  handBack: boolean;
  reason?: string;
} {
  const match = raw.match(HANDBACK_MARKER_RE);
  if (!match) {
    return { content: raw.trim(), handBack: false };
  }
  const reason = (match[1] ?? "").trim() || "out of specialist domain";
  const cleaned = raw.replace(HANDBACK_MARKER_RE, "").trim();
  return { content: cleaned, handBack: true, reason };
}
