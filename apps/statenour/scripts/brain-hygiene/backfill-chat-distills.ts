/**
 * Distill every chat that never got a chat_summary row (brain backfill W1, 2026-10-30).
 *
 * Measured on prod 2026-10-30 (read-only census): 107 chats with >=4 messages (1,379 messages, May 5 - Jul 13)
 * have no distilled memory. The distill-sessions cron was down 2026-05-28..08-06 and came back reading only the
 * last 30 days, so those chats aged out before it could reach them. The cron's queue now reaches any age (W1),
 * which drains them at 10 a night; this script drains them in one pass instead.
 *
 * Writes ONLY through distillConversation() from lib/brain/session-distiller.ts, the live cron's writer:
 * one "fast" aiChat call per chat on the existing provider chain, then admitMemory() (trust AGENT_INFERRED,
 * validFrom = the chat's last message, evidenceRefs conversation:<id>, key = the conversation id). A chat whose
 * last message is over 14 days old does not touch nick_current_concerns. Nothing is invented: a failed or
 * unparseable model reply writes nothing.
 *
 * Additive, so there is nothing to back up. Candidates exclude any chat with a chat_summary row at all (live or
 * soft-deleted), so no existing row is overwritten. Rollback is a soft delete of exactly the rows this run wrote.
 *
 * Usage (from apps/statenour; the manager runs it on Nour's go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-chat-distills.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-chat-distills.ts --read       # count and ids, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-chat-distills.ts --execute --expect=<count from --read>
 */
import { Module } from "node:module";
import { fail, finish, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

/**
 * session-distiller reaches lib/ai/extract-structured.ts, which does `import "server-only"` and throws
 * under bare tsx (PR 3379 review). Same neutralizer as scripts/backfill-persona-judgments.ts and
 * scripts/measure-prompt-size.ts: an empty module is what server-only's own react-server build returns.
 * Tooling only; the production build is unaffected.
 */
function neutralizeServerOnly(): void {
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

/** The real writer, loaded lazily so plan and --read never import Prisma or the AI chain. */
export async function loadDistill(): Promise<Distill> {
  neutralizeServerOnly();
  return (await import("@/lib/brain/session-distiller")).distillConversation;
}

/** Ids and dates only: never message or summary text. Oldest first, so the backlog fills in chronologically. */
export const READ_SQL = `
SELECT c.id, c.updated_at::text AS updated_at
  FROM chat_conversations c
 WHERE c.updated_at < now() - interval '30 minutes'
   AND (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) >= 4
   AND NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.category = 'chat_summary' AND bm.key = c.id)
 ORDER BY c.updated_at ASC, c.id`;

/** Claim check right before each distill: the nightly cron may have reached the chat since --read. */
const ROWS_SQL = `
SELECT COUNT(*)::int AS any_rows
  FROM brain_memories WHERE category = 'chat_summary' AND key = $1 /* chat_summary_rows */`;

/** The database clock (created_at is a UTC timestamp), read right before each distill. Never the client clock. */
const NOW_SQL = `SELECT (now() AT TIME ZONE 'UTC')::text AS db_now`;

/** The landed check: the live row for the chat, and whether it was created at or after that clock read (ours) or before it (raced). */
const LANDED_SQL = `
SELECT id, created_at >= $2::timestamp AS ours
  FROM brain_memories WHERE category = 'chat_summary' AND key = $1 AND deleted_at IS NULL /* chat_summary_landed */`;

/** Consecutive misses at the start that mean the provider is down: stop spending. */
const EARLY_ABORT = 3;

type Row = { id: string; updated_at: string };
type Distill = (conversationId: string) => Promise<unknown>;
interface Deps {
  distill?: Distill;
  pauseMs?: number;
  now?: () => Date;
}

/**
 * The nightly distill-sessions run fires at 03:00Z inside the mega-evening fan-out. The claim check here
 * and that cron are separate processes with no shared lock, so overlapping them can spend two model calls
 * on one chat (Codex on PR 3379). Keeping the drain out of 02:45-03:45Z removes the overlap instead of
 * adding a cross-process lock; a raced row is still excluded from the rollback by the clock check.
 */
export function inNightlyWindow(now: Date): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 2 * 60 + 45 && minutes < 3 * 60 + 45;
}

const loadIds = (db: Db) => db.query<Row>(READ_SQL);

async function anyRows(db: Db, id: string): Promise<number> {
  return toCount((await db.query<{ any_rows: number }>(ROWS_SQL, id))[0]?.any_rows);
}

export const spec: HygieneSpec = {
  name: "backfill-chat-distills",

  plan: () => [
    "",
    "1. SELECT the chats with >=4 messages, idle 30+ min, and no chat_summary row at all (ids and dates only):",
    READ_SQL,
    "2. --execute only, one chat at a time, oldest first:",
    "   a. re-check the chat still has no chat_summary row (skip it if the cron got there first);",
    "   b. distillConversation(id): one aiChat 'fast' call, then admitMemory(chat_summary, key=id, source=session_distiller,",
    "      AGENT_INFERRED, validFrom = last message). Chats older than 14 days leave nick_current_concerns alone;",
    "   c. re-count: a row that did not land is a miss. 3 misses in a row at the start abort the run.",
    "3. Print the soft-delete rollback for exactly the ids that landed. No statement removes a row.",
  ],

  async read(db) {
    const rows = await loadIds(db);
    const range = rows.length ? `${rows[0].updated_at.slice(0, 10)} .. ${rows[rows.length - 1].updated_at.slice(0, 10)}` : "(none)";
    return {
      count: rows.length,
      lines: [
        `chats with no chat_summary row : ${rows.length}`,
        `last activity range           : ${range}`,
        `conversation ids              : ${rows.map((r) => r.id).join(",") || "(none)"}`,
      ],
    };
  },

  async execute(db, { expect, log }, deps?: unknown) {
    const d = (deps ?? {}) as Deps;
    if (inNightlyWindow((d.now ?? (() => new Date()))())) {
      log("ABORT: 02:45-03:45Z is the nightly distill-sessions window; run the drain outside it. Nothing written.");
      return 1;
    }
    const rows = await loadIds(db);
    if (rows.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${rows.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (rows.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const distill: Distill = d.distill ?? (await loadDistill());
    const pauseMs = d.pauseMs ?? 200;

    const landed: string[] = [];
    const rowIds: string[] = [];
    const missed: string[] = [];
    let skipped = 0;
    let raced = 0;
    // try/finally (PR 3379 review): a throw part-way (a dropped connection on a read) must still print what
    // landed and the rollback for it, then rethrow.
    try {
      for (const { id } of rows) {
        if ((await anyRows(db, id)) > 0) {
          skipped++;
          continue;
        }
        const dbNow = (await db.query<{ db_now: string }>(NOW_SQL))[0]?.db_now;
        if (!dbNow) throw new Error("database clock read returned nothing");
        try {
          await distill(id);
        } catch (e) {
          log(`  ${id}: distill threw (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`);
        }
        const row = (await db.query<{ id: string; ours: boolean }>(LANDED_SQL, id, dbNow))[0];
        if (row?.ours) {
          landed.push(id);
          rowIds.push(row.id);
        } else if (row) {
          raced++; // the nightly cron wrote it between the claim check and the distill: not ours to roll back
        } else {
          missed.push(id);
        }
        if (landed.length === 0 && missed.length >= EARLY_ABORT) {
          log(`ABORT: the first ${EARLY_ABORT} chats wrote nothing (provider down or replies unparseable). Stopped spending.`);
          break;
        }
        if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
      }
    } finally {
      log(
        `landed ${landed.length} of ${rows.length} · skipped ${skipped} (gained a row since --read) · raced ${raced} (the cron wrote it first) · missed ${missed.length}`,
      );
      if (missed.length) log(`not landed: ${missed.join(",")}`);
      if (rowIds.length) {
        log(
          `\nROLLBACK (soft delete of exactly the ${rowIds.length} rows this run wrote, by row id):\n` +
            `UPDATE brain_memories SET deleted_at = now(), metadata = COALESCE(metadata, '{}'::jsonb) || '{"deletedBy":"backfill-chat-distills-rollback"}'::jsonb\n` +
            ` WHERE category = 'chat_summary' AND deleted_at IS NULL AND id = ANY('{${rowIds.join(",")}}'::text[]);\n`,
        );
      }
    }
    return missed.length === 0 ? 0 : 1;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then(finish, fail);
}
