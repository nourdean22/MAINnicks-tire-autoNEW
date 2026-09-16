/**
 * logInteractionFromText · one typed line → one ledger row · 2026-09-16.
 *
 * The server half of the ⌘K grammar, for surfaces that hand us text instead
 * of a picked PersonProfile: Telegram `/log dania +5 coffee, talked about the
 * move`. Parses with the shared grammar, resolves the name through the same
 * fuzzy chain Nick uses (never creating a profile), and writes through the
 * ledger seam. Every outcome is a value, so the caller can phrase the reply
 * for its surface; nothing here sends anything.
 */

import { parseLedgerQuery } from "./parse-ledger-query";
import { recordInteraction, type LedgerSource, type RecordedInteraction } from "./record-interaction";

export type LogFromTextOutcome =
  | { kind: "usage" }
  | { kind: "rejected_name"; name: string }
  | { kind: "no_match"; name: string }
  | { kind: "logged"; recorded: RecordedInteraction; matchTier: string };

export async function logInteractionFromText(
  text: string,
  source: Extract<LedgerSource, "telegram" | "chat">,
  metadata: Record<string, unknown> = {},
): Promise<LogFromTextOutcome> {
  const parsed = parseLedgerQuery(text);
  if (!parsed) return { kind: "usage" };

  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(parsed.rawName, { createIfMissing: false });
  if (resolution.matchTier === "rejected_nonname") {
    return { kind: "rejected_name", name: parsed.rawName };
  }
  if (!resolution.matched || !resolution.person) {
    return { kind: "no_match", name: parsed.rawName };
  }

  const recorded = await recordInteraction({
    personId: resolution.person.id,
    amount: parsed.amount,
    note: parsed.note,
    source,
    metadata: { via: `${source}_command`, matchTier: resolution.matchTier, ...metadata },
  });
  return { kind: "logged", recorded, matchTier: resolution.matchTier };
}
