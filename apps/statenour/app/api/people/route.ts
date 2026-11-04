/**
 * GET /api/people — list PersonProfile rows with derived state.
 * v10.0.529.106 · Wave 67.
 *
 * The people-intelligence backend (lib/brain/people-intelligence.ts ·
 * 218 LOC) has been building PersonProfile rows + trust scores +
 * neglect detection for months. Pre-Wave-67 there was no operator-
 * facing surface · the engine fired alerts into the system prompt
 * and that was it. This endpoint exposes the full set for the
 * /relationships page.
 *
 * Sort: most-recently-interacted first when `sort=recent` ·
 * highest-trust first when `sort=trust` · neglect-first when
 * `sort=neglect` (the operator-action mode).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external
 * fetch consumers · returning unwrapped data lets the envelope wrap
 * cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysSinceContact, isNeglected } from "@/lib/services/people/neglect";
import { isSparsePerson } from "@/lib/people/needs-info";
import { contactRowsOnly, GENERIC_NOTE } from "@/lib/services/people/contact-rows";
import { journalExcerpt, type LatestJournal } from "@/lib/services/people/journal-link";
import { PEOPLE_RUN_EVENT, PEOPLE_RUN_STALE_MS, type PeopleRunState } from "@/lib/brain/people-intelligence-run";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/people");

/** Newest ledger rows read per person; the first CONTACT row among them is the note shown on the list. */
const NOTE_LOOKBACK = 5;

/** The engine line on /people: the newest run's state. `never` = no row ever; `unknown` = the read failed. */
export interface EngineLine {
  state: PeopleRunState | "ran" | "never" | "unknown";
  at: string | null;
  reason: string | null;
}

/** Rows before W8b carried the result only in `detail`; "(enrich: x)" there was the one failure signal. */
function engineLineOf(row: { createdAt: Date; detail: string; payload: unknown } | null): EngineLine {
  if (!row) return { state: "never", at: null, reason: null };
  const at = row.createdAt.toISOString();
  const p = row.payload && typeof row.payload === "object" ? (row.payload as { state?: unknown; reason?: unknown }) : null;
  const reason = typeof p?.reason === "string" ? p.reason : null;
  if (p?.state === "running") {
    return Date.now() - row.createdAt.getTime() > PEOPLE_RUN_STALE_MS
      ? { state: "failed", at, reason: "did not finish" }
      : { state: "running", at, reason: null };
  }
  if (p?.state === "ok" || p?.state === "failed" || p?.state === "nothing_to_propose" || p?.state === "partial") return { state: p.state, at, reason };
  const legacyFail = /\(enrich: (\w+)\)/.exec(row.detail);
  // An old row says only that it ran; "ok" would claim it proposed something.
  return legacyFail ? { state: "failed", at, reason: legacyFail[1] } : { state: "ran", at, reason: null };
}

export const dynamic = "force-dynamic";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
  /** Newest contact note from the ledger (chat digests and the backfill write here, not to the profile). */
  latestNote: { note: string; at: string; source: string } | null;
  /** Newest journal entry naming the person (brain_dumps.person_ids); null = none, or the read failed (see `reads`). */
  latestJournal: LatestJournal | null;
  /** A proposal (role, notes, trust or cadence) is parked in pendingClassification for his Accept or Dismiss. */
  suggestionWaiting: boolean;
}

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") ?? "recent";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

    const orderBy = sort === "trust"
      ? { trustScore: "desc" as const }
      : sort === "neglect"
      ? { lastInteraction: { sort: "asc" as const, nulls: "last" as const } }
      : { lastInteraction: { sort: "desc" as const, nulls: "last" as const } };

    const rows = await prisma.personProfile.findMany({
      // 2026-05-28 · Wave AC.b · operator bug · soft-deleted rows still
      // showed in the relationships list because the findMany was missing
      // the `deletedAt: null` filter. The softDeletePerson mutation does
      // set `deletedAt` correctly · the list query just wasn't honoring
      // it. Single-line fix · all sibling endpoints (watchlist, morning-
      // brief, search) already filter the same way.
      where: { deletedAt: null },
      orderBy,
      take: limit,
      select: {
        id: true,
        name: true,
        role: true,
        relationship: true,
        trustScore: true,
        leverageNotes: true,
        lastInteraction: true,
        interactionCount: true,
        cadenceDays: true,
        pendingClassification: true,
        // shortcut: a person whose newest NOTE_LOOKBACK rows are all status flips or mentions reads null; widen if that shows up.
        ledger: {
          orderBy: { createdAt: "desc" },
          take: NOTE_LOOKBACK,
          select: { note: true, createdAt: true, source: true, metadata: true },
        },
      },
    });

    // W8 · one definition, shared with lib/brain/people-intelligence.ts. The
    // hand-rolled copy here rounded the day count and compared `> 14` while
    // the brain copies compared a Date against `daysAgo(14)`, so a person
    // 14.4 days quiet was neglected in one surface and not the other.
    const nowDate = new Date();

    // A failed read is not an empty journal: every latestJournal is null AND reads.journal says "failed".
    let journal = new Map<string, LatestJournal>();
    let journalRead: "ok" | "failed" = "ok";
    if (rows.length > 0) {
      try {
        // ONE query, the newest live entry PER listed person however old (Prisma has no DISTINCT ON over an array).
        // W8b: over brain_dumps AND reflections (the /journal composer writes reflections; both carry person_ids).
        const latest = await prisma.$queryRaw<Array<{ person_id: string; id: string; created_at: Date; raw_thoughts: string; kind: string }>>`
          SELECT DISTINCT ON (pid) pid AS person_id, d.id, d.created_at, d.raw_thoughts, d.kind
          FROM (
            SELECT d.id, d.created_at, d.raw_thoughts, d.person_ids, 'journal' AS kind FROM brain_dumps d WHERE d.deleted_at IS NULL
            UNION ALL
            SELECT r.id, r.created_at, r.insight AS raw_thoughts, r.person_ids, 'reflection' AS kind FROM reflections r WHERE r.deleted_at IS NULL
          ) d CROSS JOIN LATERAL unnest(d.person_ids) AS pid
          WHERE pid = ANY(${rows.map((r) => r.id)}::text[])
          ORDER BY pid, d.created_at DESC`;
        const nameOf = new Map(rows.map((r) => [r.id, r.name]));
        journal = new Map(
          latest.map((l) => [
            l.person_id,
            // Windowed around the person's name (W8b), so the line is the sentence about them.
            {
              at: new Date(l.created_at).toISOString(),
              excerpt: journalExcerpt(l.raw_thoughts, nameOf.get(l.person_id)),
              dumpId: l.id,
              kind: l.kind === "reflection" ? ("reflection" as const) : ("journal" as const),
            },
          ]),
        );
      } catch (err) {
        journalRead = "failed";
        log.warn("people_latest_journal_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // The engine line: a failed read is `unknown`, never `ok` (empty-vs-error).
    let engine: EngineLine;
    try {
      engine = engineLineOf(
        await prisma.auditEvent.findFirst({
          where: { eventType: PEOPLE_RUN_EVENT },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, detail: true, payload: true },
        }),
      );
    } catch (err) {
      log.warn("people_engine_run_read_failed", { error: err instanceof Error ? err.message : String(err) });
      engine = { state: "unknown", at: null, reason: null };
    }

    const people: PersonRow[] = rows.map((r) => {
      const daysSinceInteraction = daysSinceContact(r, nowDate);
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        relationship: r.relationship,
        trustScore: r.trustScore,
        leverageNotes: r.leverageNotes,
        lastInteraction: r.lastInteraction ? r.lastInteraction.toISOString() : null,
        interactionCount: r.interactionCount,
        daysSinceInteraction,
        isNeglected: isNeglected(r, nowDate),
        latestNote: (() => {
          // W8b (audit B10): a journal row IS the journal line beneath; the generic backfill note says nothing about them.
          const n = contactRowsOnly(r.ledger).find((row) => row.source !== "journal" && !GENERIC_NOTE.test(row.note));
          return n ? { note: n.note, at: n.createdAt.toISOString(), source: n.source } : null;
        })(),
        latestJournal: journal.get(r.id) ?? null,
        suggestionWaiting: r.pendingClassification !== null,
      };
    });

    // Roll-up counts for the page header
    const totals = {
      total: people.length,
      neglected: people.filter((p) => p.isNeglected).length,
      high_trust: people.filter((p) => p.trustScore >= 0.7).length,
      sparse: people.filter(isSparsePerson).length,
      suggestionsWaiting: people.filter((p) => p.suggestionWaiting).length,
    };

    return {
      people,
      totals,
      engine,
      reads: { journal: journalRead },
      generatedAt: new Date().toISOString(),
    };
  },
  { auth: "owner" },
);
