/**
 * Close the overdue, never-reviewed DecisionReplay rows as "not reviewed, expired".
 *
 * Measured on prod 2026-10-23 (docs/research/2026-10-23-brain-usage-map.md, B4): 29 replays, 0 ever reviewed,
 * 28 with reviewAt <= now(), oldest due 2026-04-25, none created since 2026-09-28. Three readers keep counting
 * them: the "Decision Review Due" Telegram rule (lib/brain/autonomous-engine.ts, 3 per firing), the blind-spot
 * replay count (lib/brain/blind-spot-detector.ts), and the Daily Tutor's overdue-decision pick
 * (lib/brain/tutor-pack.ts). Closing them stops all three.
 *
 * HONESTY: outcome says "not reviewed, expired", outcomeScore stays NULL, and lesson gets a dated note only
 * if it is empty. No score or lesson is invented, and nothing is deleted.
 *
 * Usage (from apps/statenour; the manager runs it on Nour's typed go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/close-overdue-replays.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/close-overdue-replays.ts --read       # counts and ids, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/close-overdue-replays.ts --execute --expect=28
 */
import { backupExists, backupName, isEntry, runHygiene, toCount, type HygieneSpec } from "./_run";

export const OUTCOME = "not reviewed, expired";
const BATCH = 1000;

/** Ids and the version of each row only: no title, choice, reasoning or context text. */
const READ_SQL = `
SELECT id, "reviewAt"::text AS review_at
  FROM decision_replays
 WHERE reviewed = false AND "reviewAt" <= now()
 ORDER BY "reviewAt", id`;

/**
 * Compare-and-swap on the exact rows read. Pins every field the decision read: identity, the unreviewed flag,
 * the due date (and that it is still due), and that nobody recorded an outcome or a review time meanwhile.
 * $3 is the outcome text, $4 the lesson note used only when lesson is empty.
 */
export const CAS_SQL = `
UPDATE decision_replays r
   SET reviewed = true, outcome = $3, "reviewedAt" = now(), lesson = COALESCE(r.lesson, $4)
  FROM unnest($1::text[], $2::text[]) AS c(id, review_at)
 WHERE r.id = c.id
   AND r.reviewed = false
   AND r."reviewAt" <= now()
   AND r."reviewAt"::text = c.review_at
   AND r.outcome IS NULL
   AND r."reviewedAt" IS NULL`;

async function loadIds(db: Parameters<HygieneSpec["read"]>[0]): Promise<Array<{ id: string; review_at: string }>> {
  return db.query<{ id: string; review_at: string }>(READ_SQL);
}

export const spec: HygieneSpec = {
  name: "close-overdue-replays",

  plan: () => [
    "",
    "1. SELECT the overdue unreviewed replays (ids and due dates only):",
    READ_SQL,
    "2. --execute only: CREATE TABLE _bak_decision_replays_overdue_close_<yyyymmdd> AS SELECT * FROM decision_replays WHERE id = ANY(<ids>);",
    "   count source vs backup, abort on mismatch; refuse if the backup table already exists.",
    `3. --execute only: compare-and-swap, batches of ${BATCH}:`,
    CAS_SQL,
    `   outcome = ${JSON.stringify(OUTCOME)}; outcomeScore is never set; lesson gets a dated note only when empty.`,
    "4. --execute only: re-count the closed rows; print the rollback SQL. No statement removes a row.",
  ],

  async read(db) {
    const rows = await loadIds(db);
    return {
      count: rows.length,
      lines: [`overdue, unreviewed : ${rows.length}`, `replay ids           : ${rows.map((r) => r.id).join(",") || "(none)"}`],
    };
  },

  async execute(db, { expect, today, log }) {
    const rows = await loadIds(db);
    if (rows.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${rows.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (rows.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const bak = backupName("decision_replays", "overdue_close", today);
    if (await backupExists(db, bak)) {
      log(`ABORT: backup table ${bak} already exists. Inspect it, then drop or rename it by hand. Nothing written.`);
      return 1;
    }
    const ids = rows.map((r) => r.id);
    await db.exec(`CREATE TABLE ${bak} AS SELECT * FROM decision_replays WHERE id = ANY($1::text[])`, ids);
    const backedUp = toCount((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak}`))[0]?.n);
    log(`backup ${bak}: ${backedUp} of ${ids.length} rows`);
    if (backedUp !== ids.length) {
      log(`ABORT: backup holds ${backedUp} rows, expected ${ids.length}. Nothing swapped. The backup table is left in place.`);
      return 1;
    }
    const rollback =
      `UPDATE decision_replays r SET reviewed = k.reviewed, outcome = k.outcome, "reviewedAt" = k."reviewedAt", lesson = k.lesson\n` +
      `  FROM ${bak} k WHERE r.id = k.id;`;
    log(`\nROLLBACK (restores the four columns this script wrote):\n${rollback}\n`);

    const note = `Closed without review on ${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)} (overdue, no outcome was given). No score recorded.`;
    let closed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const b = rows.slice(i, i + BATCH);
      closed += await db.exec(CAS_SQL, b.map((r) => r.id), b.map((r) => r.review_at), OUTCOME, note);
    }
    const now = toCount(
      (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM decision_replays WHERE id = ANY($1::text[]) AND reviewed = true AND outcome = $2`, ids, OUTCOME))[0]?.n,
    );
    log(`closed ${closed} of ${ids.length}; re-count shows ${now} closed.`);
    if (closed !== ids.length || now !== ids.length) {
      log("MISMATCH: some rows changed between the read and the swap (the compare-and-swap skipped them). Re-run --read; roll back with the SQL above if needed.");
      return 1;
    }
    log(`ROLLBACK (again, for the record):\n${rollback}`);
    return 0;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then((code) => process.exit(code));
}
