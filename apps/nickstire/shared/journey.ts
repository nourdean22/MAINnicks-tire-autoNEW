/**
 * journey — pure exact-key session-join helpers (journey-join wave 2026-06).
 *
 * Joins ONLY on identical sessionId values (the localStorage visitor id
 * captured by migration 0068 columns). No time-window guessing, no
 * phone-number heuristics, no fabricated links: a row without a sessionId
 * is reported in `coverage.unattributed`, never force-matched.
 *
 * Click -> actual-phone-call (vapi_call_logs) matching is deliberately NOT
 * here — that join is approximate by nature (time windows) and lives only
 * as a spec until an exact key exists. See
 * docs/audits/NICKSTIRE-AUTONOMOUS-ATTRIBUTION-COMPLETION.md.
 */

export interface JourneyRow {
  /** Which surface the row came from (e.g. "call_click", "lead", "booking"). */
  kind: string;
  /** Row id on its own table. */
  id: number;
  /** Visitor id — null when the browser blocked storage or the row predates 0068. */
  sessionId: string | null;
  /** Timestamp (ISO string or Date) for ordering within a journey. */
  at: string | Date;
}

export interface SessionJourney {
  sessionId: string;
  /** Rows in chronological order. */
  steps: JourneyRow[];
  /** Distinct kinds present — quick "click+lead" / "lead+booking" reads. */
  kinds: string[];
}

export interface JourneyCoverage {
  totalRows: number;
  /** Rows that carry a sessionId and therefore CAN be joined. */
  attributed: number;
  /** Rows with no sessionId — honest blind spot, never guessed. */
  unattributed: number;
  /** Joined journeys with 2+ steps (the only ones that say anything). */
  multiStepJourneys: number;
}

/**
 * Group rows from any mix of surfaces into per-visitor journeys.
 * Pure + deterministic; rows lacking sessionId are counted, not joined.
 */
export function buildSessionJourneys(rows: JourneyRow[]): {
  journeys: SessionJourney[];
  coverage: JourneyCoverage;
} {
  const bySession = new Map<string, JourneyRow[]>();
  let unattributed = 0;

  for (const row of rows) {
    if (!row.sessionId) {
      unattributed += 1;
      continue;
    }
    const list = bySession.get(row.sessionId) ?? [];
    list.push(row);
    bySession.set(row.sessionId, list);
  }

  const journeys: SessionJourney[] = [...bySession.entries()].map(([sessionId, steps]) => {
    const ordered = [...steps].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    return {
      sessionId,
      steps: ordered,
      kinds: [...new Set(ordered.map(s => s.kind))],
    };
  });

  return {
    journeys,
    coverage: {
      totalRows: rows.length,
      attributed: rows.length - unattributed,
      unattributed,
      multiStepJourneys: journeys.filter(j => j.steps.length >= 2).length,
    },
  };
}
