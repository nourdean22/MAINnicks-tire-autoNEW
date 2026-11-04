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

import { prisma } from "@/lib/prisma";
import { parseLedgerQuery } from "./parse-ledger-query";
import { recordInteraction, type LedgerSource, type RecordedInteraction } from "./record-interaction";

export type LogFromTextOutcome =
  | { kind: "usage" }
  | { kind: "rejected_name"; name: string }
  | { kind: "no_match"; name: string }
  | { kind: "ambiguous"; name: string; reason: AmbiguousReason; candidates: LedgerCandidate[] }
  | { kind: "logged"; recorded: RecordedInteraction; matchTier: string };

export type LedgerCandidate = { id: string; name: string };
/** same_name: more than one person spells it that way. typo_match: only a typo-close name matched. */
export type AmbiguousReason = "same_name" | "typo_match";

export type LedgerPersonResolution =
  | { kind: "rejected_name"; name: string }
  | { kind: "no_match"; name: string }
  | { kind: "ambiguous"; name: string; reason: AmbiguousReason; candidates: LedgerCandidate[] }
  | { kind: "resolved"; person: LedgerCandidate; matchTier: string };

/**
 * Which person a ledger line is about: the one resolution every ledger writer
 * that starts from a NAME shares (Telegram /log here, Nick's logPersonInteraction
 * tool). The fuzzy chain never creates a profile. Two people who spell the name
 * the same way are ambiguous, never the first row Postgres returns. A typo-close
 * match (Levenshtein / Jaro-Winkler) is a guess: a caller that cannot show the
 * name back before it writes passes `allowTypoMatch: false` and gets it back as
 * ambiguous, to ask about.
 */
export async function resolveLedgerPerson(
  rawName: string,
  opts: { allowTypoMatch: boolean },
): Promise<LedgerPersonResolution> {
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(rawName, { createIfMissing: false });
  if (resolution.matchTier === "rejected_nonname") return { kind: "rejected_name", name: rawName };
  if (!resolution.matched || !resolution.person) return { kind: "no_match", name: rawName };

  if (resolution.matchTier === "case_insensitive") {
    // name is @unique only case-sensitively: "Mash" and "MASH" can both exist.
    const same = await prisma.personProfile.findMany({
      where: { name: { equals: rawName.trim(), mode: "insensitive" }, deletedAt: null },
      select: { id: true, name: true },
      take: 5,
    });
    if (same.length > 1) return { kind: "ambiguous", name: rawName, reason: "same_name", candidates: same };
  }
  if (!opts.allowTypoMatch && (resolution.matchTier === "levenshtein" || resolution.matchTier === "jaro_winkler")) {
    return { kind: "ambiguous", name: rawName, reason: "typo_match", candidates: [resolution.person] };
  }
  return { kind: "resolved", person: resolution.person, matchTier: resolution.matchTier };
}

export async function logInteractionFromText(
  text: string,
  source: Extract<LedgerSource, "telegram" | "chat">,
  metadata: Record<string, unknown> = {},
): Promise<LogFromTextOutcome> {
  const parsed = parseLedgerQuery(text);
  if (!parsed) return { kind: "usage" };

  // The Telegram reply names the person it logged to, so a typo-close match is shown back.
  const who = await resolveLedgerPerson(parsed.rawName, { allowTypoMatch: true });
  if (who.kind !== "resolved") return who;

  const recorded = await recordInteraction({
    personId: who.person.id,
    amount: parsed.amount,
    note: parsed.note,
    source,
    metadata: { via: `${source}_command`, matchTier: who.matchTier, ...metadata },
  });
  return { kind: "logged", recorded, matchTier: who.matchTier };
}
