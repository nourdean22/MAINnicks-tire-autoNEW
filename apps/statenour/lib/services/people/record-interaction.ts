/**
 * recordInteraction · the ONE writer of the relationship ledger · 2026-09-16.
 *
 * Measured on Neon before this file existed: 23 ledger rows ever, the last on
 * 2026-07-10 — while person_profiles.interaction_count summed to 191 and
 * last_interaction kept advancing into September. The counters and the ledger
 * could not agree because nothing made them: three paths bumped the counters
 * with no ledger row behind them (a chat MENTION in the conversation digest,
 * every person.update from Nick, profile creation), two wrote rows with
 * private copies of the counter bump (task.logLedger, the log-outreach
 * route), and the eight "chat" rows were a synthetic backfill stamped
 * `synthetic: true` on 2026-05-29. Zero live automatic writers existed.
 *
 * Contract:
 *   · one transaction: ledger row + interactionCount + lastInteraction. A row
 *     without a bump, or a bump without a row, cannot come out of this file.
 *   · `at` is WHEN it happened (default now): it is the row's createdAt, and
 *     lastInteraction only moves FORWARD — logging yesterday's coffee never
 *     rewinds a more recent contact. The guard is in the UPDATE's WHERE
 *     (`lastInteraction < at`), so it holds under concurrent writers too.
 *   · `creditXp` (default true) credits mastery XP for a positive amount; an
 *     automatic writer passes false — a rep the operator did not confirm
 *     earns nothing (the 2026-06-01 rule: real reps, not cataloguing).
 *   · the note is embedded for recall (>= 20 chars). Embed + XP run
 *     fire-and-forget AFTER the commit, so they can never roll a row back.
 *
 * recordInteractionOnce is the exclusive variant for automatic writers: at
 * most one row per person inside a window (the conversation that produced
 * it). Two compiles of the same conversation, or a compile racing the
 * operator's own log, must not both write. The check and the write sit
 * behind a per-person TRANSACTION ADVISORY LOCK that every writer in this
 * file takes as its first statement, so no writer can interleave with the
 * count at any isolation level, and a writer that commits while we wait is
 * visible to the count (claim-before-act). The first cut used Serializable
 * isolation instead — Codex P2 on #2346: that only excludes OTHER
 * Serializable transactions, and the operator writers ran at the default
 * level, so a same-instant human log and digest compile could both commit.
 *
 * The deliberate exception: `flipPersonStatus` writes its status-flip audit
 * row straight to the table and does NOT go through here, because a status
 * change is not contact and must not move lastInteraction.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { assertWritableMetadata } from "@/lib/services/people/contact-rows";

const log = rootLogger.withSurface("services/people/record-interaction");

/** Every source the ledger carries. The modal + tRPC mutation expose the operator-facing subset. */
export const LEDGER_SOURCES = [
  "manual",
  "chat",
  "telegram",
  "outreach",
  "auto",
  "gmail",
  "calendar",
  "greene_play",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

/** The modal and the ⌘K parser both stop at ±100; the seam enforces the same ceiling. */
export const LEDGER_AMOUNT_MAX = 100;

export interface RecordInteractionInput {
  personId: string;
  /** Signed: a deposit (+) or a withdrawal (−). Truncated and clamped to ±LEDGER_AMOUNT_MAX. */
  amount: number;
  note: string;
  source: LedgerSource;
  metadata?: Record<string, unknown>;
  /** When the interaction happened. Default: now. */
  at?: Date;
  /** Credit mastery XP for a positive amount. Default: true. */
  creditXp?: boolean;
}

export interface RecordedInteraction {
  ledgerId: string;
  personId: string;
  personName: string;
  amount: number;
  note: string;
  source: LedgerSource;
  at: Date;
  /** The profile's lastInteraction AFTER this write (never earlier than before it). */
  lastInteraction: Date | null;
  interactionCount: number;
}

export class PersonNotFoundError extends Error {
  constructor(personId: string) {
    super(`No person with id ${personId}`);
    this.name = "PersonNotFoundError";
  }
}

interface Prior {
  name: string;
  role: string;
  lastInteraction: Date | null;
}

interface Normalized {
  note: string;
  amount: number;
  at: Date;
}

function normalize(input: RecordInteractionInput): Normalized {
  // W8 (Codex P2 on #2348): this seam increments interactionCount, so it may
  // not write a marker that excludes its own row from the counters. Checked
  // here, before any IO, so EVERY caller is covered — including
  // recordInteractionOnce and any future writer.
  assertWritableMetadata(input.metadata);
  const note = input.note.trim().slice(0, 2000);
  if (!note) throw new Error("note_required");
  if (!Number.isFinite(input.amount)) throw new Error("amount_invalid");
  const amount = Math.max(
    -LEDGER_AMOUNT_MAX,
    Math.min(LEDGER_AMOUNT_MAX, Math.trunc(input.amount)),
  );
  return { note, amount, at: input.at ?? new Date() };
}

async function readPrior(personId: string): Promise<Prior> {
  const prior = await prisma.personProfile.findUnique({
    where: { id: personId },
    select: { name: true, role: true, lastInteraction: true },
  });
  if (!prior) throw new PersonNotFoundError(personId);
  return prior;
}

/**
 * Per-person mutual exclusion for EVERY writer, at any isolation level.
 * Transaction-scoped (released at commit or rollback), keyed by the person,
 * namespaced so it cannot collide with other advisory keys in this database
 * (lib/services/google-oauth.ts uses the same mechanism for its refresh race).
 */
export async function lockPerson(tx: Prisma.TransactionClient, personId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`relationship_ledger:${personId}`}))`;
}

/** The atomic core — row + both counters — inside the caller's transaction, AFTER lockPerson. */
async function writeRow(
  tx: Prisma.TransactionClient,
  input: RecordInteractionInput,
  n: Normalized,
): Promise<{ ledgerId: string; lastInteraction: Date | null; interactionCount: number }> {
  const ledger = await tx.relationshipLedger.create({
    data: {
      personId: input.personId,
      amount: n.amount,
      note: n.note,
      source: input.source,
      createdAt: n.at,
      metadata: (input.metadata ?? undefined) as never,
    },
    select: { id: true },
  });
  await tx.personProfile.update({
    where: { id: input.personId },
    data: { interactionCount: { increment: 1 } },
    select: { id: true },
  });
  // Forward only. The predicate, not a pre-read, decides — a concurrent later
  // contact keeps its timestamp even if this write commits second.
  await tx.personProfile.updateMany({
    where: {
      id: input.personId,
      OR: [{ lastInteraction: null }, { lastInteraction: { lt: n.at } }],
    },
    data: { lastInteraction: n.at },
  });
  const after = await tx.personProfile.findUniqueOrThrow({
    where: { id: input.personId },
    select: { lastInteraction: true, interactionCount: true },
  });
  return {
    ledgerId: ledger.id,
    lastInteraction: after.lastInteraction,
    interactionCount: after.interactionCount,
  };
}

/** Post-commit side effects. Both fire-and-forget; neither can undo the row. */
function afterCommit(args: {
  ledgerId: string;
  personId: string;
  amount: number;
  note: string;
  role: string;
  priorLastInteraction: Date | null;
  creditXp: boolean;
}): void {
  void (async () => {
    try {
      const { enqueueLedgerEmbed } = await import("@/lib/brain/people-embed-hook");
      await enqueueLedgerEmbed(args.ledgerId, args.note);
    } catch (err) {
      log.warn("ledger_embed_failed", {
        ledgerId: args.ledgerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  if (!args.creditXp) return;
  void (async () => {
    try {
      const { creditLedgerDeposit } = await import("@/lib/mastery/people-credit");
      await creditLedgerDeposit({
        ledgerId: args.ledgerId,
        personId: args.personId,
        amount: args.amount,
        note: args.note,
        role: args.role,
        priorLastInteraction: args.priorLastInteraction,
      });
    } catch (err) {
      log.warn("ledger_xp_failed", {
        ledgerId: args.ledgerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

function shape(
  input: RecordInteractionInput,
  n: Normalized,
  prior: Prior,
  written: { ledgerId: string; lastInteraction: Date | null; interactionCount: number },
): RecordedInteraction {
  return {
    ledgerId: written.ledgerId,
    personId: input.personId,
    personName: prior.name,
    amount: n.amount,
    note: n.note,
    source: input.source,
    at: n.at,
    lastInteraction: written.lastInteraction,
    interactionCount: written.interactionCount,
  };
}

/**
 * Record one interaction. Every operator-initiated writer (the modal, ⌘K,
 * Telegram /log, Nick's person.logInteraction, the picks outreach button)
 * lands here. Throws PersonNotFoundError for an unknown id, `note_required`
 * for a blank note, `amount_invalid` for a non-finite amount — all BEFORE
 * anything is written.
 */
export async function recordInteraction(
  input: RecordInteractionInput,
): Promise<RecordedInteraction> {
  const n = normalize(input);
  const prior = await readPrior(input.personId);
  const written = await prisma.$transaction(async (tx) => {
    await lockPerson(tx, input.personId);
    return writeRow(tx, input, n);
  });
  afterCommit({
    ledgerId: written.ledgerId,
    personId: input.personId,
    amount: n.amount,
    note: n.note,
    role: prior.role,
    priorLastInteraction: prior.lastInteraction,
    creditXp: input.creditXp !== false,
  });
  return shape(input, n, prior, written);
}

export type RecordOnceOutcome =
  | { skipped: false; recorded: RecordedInteraction }
  | { skipped: true; reason: "already_logged_in_window" | "lost_race"; recorded: null };

function isDeadlockAbort(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  // P2034: Prisma's "write conflict or deadlock" — Postgres 40001/40P01 underneath.
  return code === "P2034" || code === "40001" || code === "40P01";
}

/**
 * Record at most ONE interaction per person inside a window: skipped when any
 * ledger row for the person (any source) already has createdAt >= noRowSince.
 * lock → count → write, in one transaction: because every writer takes the
 * same per-person lock first, a row committed by a racer while we waited is
 * visible to the count (each statement reads a fresh snapshot at the default
 * level), so the human's row wins whichever side arrives first. A deadlock
 * abort (P2034) is unreachable between two seam writers (one lock each, the
 * same statement order) and is mapped to `lost_race` only so a
 * fire-and-forget compile never throws on a store hiccup — the next compile
 * retries.
 */
export async function recordInteractionOnce(
  input: RecordInteractionInput & { noRowSince: Date },
): Promise<RecordOnceOutcome> {
  const n = normalize(input);
  const prior = await readPrior(input.personId);
  let written: Awaited<ReturnType<typeof writeRow>> | null;
  try {
    written = await prisma.$transaction(async (tx) => {
      await lockPerson(tx, input.personId);
      const existing = await tx.relationshipLedger.count({
        where: { personId: input.personId, createdAt: { gte: input.noRowSince } },
      });
      if (existing > 0) return null;
      return writeRow(tx, input, n);
    });
  } catch (err) {
    if (isDeadlockAbort(err)) {
      log.info("interaction_once_lost_race", { personId: input.personId, source: input.source });
      return { skipped: true, reason: "lost_race", recorded: null };
    }
    throw err;
  }
  if (!written) return { skipped: true, reason: "already_logged_in_window", recorded: null };
  afterCommit({
    ledgerId: written.ledgerId,
    personId: input.personId,
    amount: n.amount,
    note: n.note,
    role: prior.role,
    priorLastInteraction: prior.lastInteraction,
    creditXp: input.creditXp !== false,
  });
  return { skipped: false, recorded: shape(input, n, prior, written) };
}
