/**
 * "Worth knowing" flag kinds for office conversations (contract ears-v2). A flag is stored as a
 * conversation fact whose kind is one of these, whose value is the exact words heard and whose
 * evidenceText is the segment they were heard in (server/services/conversationFacts.ts enforces
 * that the quote is really in that segment). Flags and the detailed account are owner-only.
 */
export const CONVERSATION_FLAG_KINDS = [
  "NEGATIVE_TALK",
  "CUSTOMER_COMPLAINT",
  "STAFF_CONFLICT",
  "SAFETY",
  "LEAVING_OR_COMPETITOR",
  "MONEY_OR_DISCOUNT",
] as const;
export type ConversationFlagKind = (typeof CONVERSATION_FLAG_KINDS)[number];

export function isConversationFlagKind(kind: unknown): kind is ConversationFlagKind {
  return typeof kind === "string" && (CONVERSATION_FLAG_KINDS as readonly string[]).includes(kind);
}

/** The exact account stored for a clip with no intelligible speech. Readers treat it as no account (the office digest stays THIN on it). */
export const NOISE_ONLY_ACCOUNT = "Only shop noise, no speech.";
