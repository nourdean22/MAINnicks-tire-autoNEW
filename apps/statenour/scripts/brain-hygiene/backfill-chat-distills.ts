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
import { fail, finish, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

/** Ids and dates only: never message or summary text. Oldest first, so the backlog fills in chronologically. */
export const READ_SQL = `
SELECT c.id, c.updated_at::text AS updated_at
  FROM chat_conversations c
 WHERE c.updated_at < now() - interval '30 minutes'
   AND (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) >= 4
   AND NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.category = 'chat_summary' AND bm.key = c.id)
 ORDER BY c.updated_at ASC, c.id`;

/** Claim check right before each distill (the nightly cron may have reached the chat since --read) and the landed check after. */
const ROWS_SQL = `
SELECT COUNT(*)::int AS any_rows, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS live_rows
  FROM brain_memories WHERE category = 'chat_summary' AND key = $1 /* chat_summary_rows */`;

/** Consecutive misses at the start that mean the provider is down: stop spending. */
const EARLY_ABORT = 3;

type Row = { id: string; updated_at: string };
type Distill = (conversationId: string) => Promise<unknown>;
interface Deps {
  distill?: Distill;
  pauseMs?: number;
}

const loadIds = (db: Db) => db.query<Row>(READ_SQL);

async function rowCounts(db: Db, id: string): Promise<{ any: number; live: number }> {
  const r = (await db.query<{ any_rows: number; live_rows: number }>(ROWS_SQL, id))[0];
  return { any: toCount(r?.any_rows), live: toCount(r?.live_rows) };
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
    const rows = await loadIds(db);
    if (rows.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${rows.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (rows.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const distill: Distill = d.distill ?? (await import("@/lib/brain/session-distiller")).distillConversation;
    const pauseMs = d.pauseMs ?? 200;
    const startedAt = new Date().toISOString();

    const landed: string[] = [];
    const missed: string[] = [];
    let skipped = 0;
    for (const { id } of rows) {
      if ((await rowCounts(db, id)).any > 0) {
        skipped++;
        continue;
      }
      try {
        await distill(id);
      } catch (e) {
        log(`  ${id}: distill threw (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`);
      }
      if ((await rowCounts(db, id)).live > 0) landed.push(id);
      else missed.push(id);
      if (landed.length === 0 && missed.length >= EARLY_ABORT) {
        log(`ABORT: the first ${EARLY_ABORT} chats wrote nothing (provider down or replies unparseable). Stopped spending.`);
        break;
      }
      if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    }

    log(`landed ${landed.length} of ${rows.length} · skipped ${skipped} (gained a row since --read) · missed ${missed.length}`);
    if (missed.length) log(`not landed: ${missed.join(",")}`);
    if (landed.length) {
      log(
        `\nROLLBACK (soft delete of exactly the rows this run wrote):\n` +
          `UPDATE brain_memories SET deleted_at = now(), metadata = COALESCE(metadata, '{}'::jsonb) || '{"deletedBy":"backfill-chat-distills-rollback"}'::jsonb\n` +
          ` WHERE category = 'chat_summary' AND source = 'session_distiller' AND deleted_at IS NULL\n` +
          `   AND created_at >= '${startedAt}' AND key = ANY('{${landed.join(",")}}'::text[]);\n`,
      );
    }
    return missed.length === 0 ? 0 : 1;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then(finish, fail);
}
