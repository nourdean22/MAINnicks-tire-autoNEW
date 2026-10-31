/**
 * People W1 backfill (2026-10-30). Gate order in lib/services/people/backfill-apply.ts.
 *
 *   (default) dry run: reads prod, prints counts and person-id suffixes, never names or
 *              notes, and writes nothing.
 *   --plan --out <file>: the same WITH the model step (see Lane B: one AgentTrace row per
 *              call), then writes the planned chat rows (ids, kind, times only) to that LOCAL
 *              file and prints its token, a short sha256 of the file.
 *   --execute --plan-file <file> --token <t>: re-hashes the file and refuses unless it is <t>,
 *              copies relationship_ledger to _bak_relationship_ledger_people_w1_20261030 and
 *              compares counts, then writes exactly the file's rows, each only when no contact
 *              row already sits inside its [start, end] window (insertWithinWindow).
 *   A missing --out, --plan-file or --token, or the retired --apply, exits 2 before any
 *   connection opens. --plan and --execute are the manager's to run; --execute only after
 *   Nour's yes on the --plan counts and token.
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/people-backfill.ts [--limit 20] [--with-model] [--plan --out <file> [--resume <file>.progress.json]]
 *
 *   --plan saves progress to <out>.progress.json after every conversation (ids, kind and times
 *   only). A run that stops early (a crash, 3 provider failures in a row, a failed digest) prints
 *   "partial plan saved: N of M", exits 1 and writes NO plan file or token; rerun with
 *   --resume <out>.progress.json to finish. Only a complete run writes <out> and its token.
 *   The script's own chat reads happen before the first model call (a read between model calls
 *   hit the 10 s connect timeout on 2026-10-30 and lost 24 digests). The digest call itself
 *   still touches the DB per conversation (lib/brain/conversation-memory.ts and the AgentTrace
 *   write in lib/ai/traced-aichat.ts); those failures are counted, with their reason, not fatal.
 *
 *   --execute: the backup copy and both counts run in one REPEATABLE READ transaction, and a
 *   refused backup (0 rows, or a count mismatch) rolls the copy back. A row that fails is listed
 *   with its error, the status reads "applied_with_failures", and the exact rerun step prints.
 *
 * Lane A (tasks): promise tasks whose promiseTo names a live person exactly.
 * Lane B (chat): conversations where his own messages name a tracked person who
 *   has no digest ledger row for that conversation yet, oldest first.
 *   `--with-model` re-reads `--limit` of them with the live digest extractor
 *   (digestConversation), one model call each, and EACH CALL WRITES ONE
 *   AgentTrace ROW to production (tracedAiChat). Without it the run counts
 *   candidates only and writes nothing.
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

const BACKUP_TABLE = "_bak_relationship_ledger_people_w1_20261030";

const suffix = (id: string) => id.slice(-6);

async function main() {
  // Parse BEFORE the Prisma import: a refused command never opens a connection.
  const apply = await import("@/lib/services/people/backfill-apply");
  let parsed: ReturnType<typeof apply.parseApplyArgs>;
  try {
    parsed = apply.parseApplyArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`refused: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  // Read the plan file BEFORE the Prisma import: a wrong path fails before any connection opens.
  const planContents = parsed.mode === "execute" ? readFileSync(parsed.planFile, "utf8") : null;
  const { prisma } = await import("@/lib/prisma");
  if (parsed.mode === "execute") {
    await execute(prisma, planContents!, parsed.token, apply);
    await prisma.$disconnect();
    return;
  }
  const LIMIT = parsed.limit;
  // The model step is opt-in: each digest call goes through tracedAiChat, which writes one
  // AgentTrace row to production (Codex on 3419). --plan implies it; a dry run needs --with-model.
  const NO_MODEL = parsed.mode === "dry" && !parsed.withModel;
  const plan = await import("@/lib/services/people/backfill-plan");

  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  // Lane A
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, personId: null, promiseTo: { not: null } },
    select: { id: true, personId: true, promiseTo: true },
  });
  const laneA = plan.planPromiseLinks(tasks, people);

  // Lane B candidates
  const ledger = await prisma.relationshipLedger.findMany({
    select: { personId: true, createdAt: true, metadata: true },
  });
  const digestRows = ledger.flatMap((r) => {
    const conversationId = (r.metadata as { conversationId?: unknown } | null)?.conversationId;
    return typeof conversationId === "string" ? [{ personId: r.personId, conversationId }] : [];
  });
  const userMsgs = await prisma.chatMessage.findMany({
    where: { role: "user" },
    select: { conversationId: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = plan.selectCandidates(userMsgs, people, digestRows);

  console.log(`people live: ${people.length}`);
  console.log(`lane A tasks: ${laneA.rows.length} links planned, ${laneA.untrackedNames} promise tasks name someone not tracked`);
  console.log(`lane B candidate conversations (a person he named has no digest row for it yet): ${candidates.length}`);
  if (NO_MODEL) console.log("model step skipped (pass --with-model to digest; each call writes one AgentTrace row)");

  let laneB: ReturnType<typeof plan.planChatInteractions> = {
    rows: [],
    skipped: { mentionOnly: 0, unmatched: 0, alreadyLogged: 0, duplicate: 0 },
  };
  let partial: { reason: string; done: number; total: number; progressPath: string | null } | null = null;
  if (!NO_MODEL) {
    const { digestConversation } = await import("@/lib/brain/conversation-memory");
    const run = await import("@/lib/services/people/backfill-plan-run");
    const slice = candidates.slice(0, LIMIT);
    const progressPath = parsed.mode === "plan" ? (parsed.resume ?? `${parsed.out}.progress.json`) : null;
    let progress = run.emptyProgress();
    if (parsed.mode === "plan" && parsed.resume) {
      progress = run.parseProgress(readFileSync(parsed.resume, "utf8"));
      console.log(`resuming: ${progress.done.length} conversations already done`);
    }
    // Every read happens HERE, before the first model call: the 2026-10-30 run lost 24 digests
    // when a per-conversation read between model calls hit the 10 s connect timeout.
    const done = new Set(progress.done);
    const ids = slice.filter((c) => !done.has(c.conversationId)).map((c) => c.conversationId);
    const msgs = ids.length
      ? await prisma.chatMessage.findMany({
          where: { conversationId: { in: ids } },
          orderBy: { createdAt: "asc" },
          select: { conversationId: true, role: true, content: true, createdAt: true },
        })
      : [];
    const byConv = new Map<string, Array<{ role: string; content: string; createdAt: Date }>>();
    for (const { conversationId, ...m } of msgs) (byConv.get(conversationId) ?? byConv.set(conversationId, []).get(conversationId)!).push(m);

    // Shared Ollama, no cross-app scheduler (board rule): one call at a time, paced,
    // and stop after 3 failures in a row instead of hammering a 429.
    const result = await run.runPlanLoop({
      candidates: slice,
      progress,
      digestOne: async ({ conversationId, firstMatchAt }) => {
        // The digest keeps the last 30 messages only, so hand it the window around the
        // turn that made this a candidate. shortcut: a message over 500 chars is still
        // cut by the digest, so a name past char 500 can undercount (never a wrong write).
        const messages = plan.digestWindow(byConv.get(conversationId) ?? [], firstMatchAt);
        if (messages.length === 0) return "too_short";
        let reason = "the digest returned nothing";
        const digest = await digestConversation(conversationId, messages).catch((err: unknown) => {
          reason = err instanceof Error ? err.message : String(err);
          return null;
        });
        // too-short conversations are not provider failures
        if (!digest) return messages.length >= 3 ? { failed: reason } : "too_short";
        const planned = plan.planChatInteractions(
          [
            {
              conversationId,
              start: messages[0].createdAt,
              end: messages[messages.length - 1].createdAt,
              mentioned: digest.peopleMentioned.map((p) => ({
                name: p.name,
                interacted: Boolean(p.interacted),
                interactionKind: p.interactionKind ?? null,
              })),
            },
          ],
          people,
          ledger,
        );
        return { rows: planned.rows, skipped: planned.skipped };
      },
      save: (p) => {
        if (progressPath) writeFileSync(progressPath, run.serializeProgress(p), "utf8");
      },
      pause: () => new Promise((r) => setTimeout(r, 3000)),
    });
    laneB = { rows: result.progress.rows, skipped: result.progress.skipped };
    const n = result.progress.done.length;
    console.log(`lane B digested: ${n} of ${result.total} (digest failures, retried on resume: ${result.progress.digestFailed})`);
    console.log(`lane B rows planned: ${laneB.rows.length}; skipped ${JSON.stringify(laneB.skipped)}`);
    if (result.status === "partial") partial = { reason: result.reason ?? "stopped", done: n, total: result.total, progressPath };
  }

  const perPerson = new Map<string, { chat: number; tasks: number }>();
  for (const r of laneB.rows) (perPerson.get(r.personId) ?? perPerson.set(r.personId, { chat: 0, tasks: 0 }).get(r.personId)!).chat++;
  for (const r of laneA.rows) (perPerson.get(r.personId) ?? perPerson.set(r.personId, { chat: 0, tasks: 0 }).get(r.personId)!).tasks++;
  for (const [id, n] of perPerson) console.log(`  person ...${suffix(id)}: chat ${n.chat}, tasks ${n.tasks}`);

  // Lane A is reported, never applied by this script; the plan file holds chat rows only.
  if (partial) {
    // No plan file and no token for an incomplete run: the token must cover the whole reviewed set.
    console.log(`partial plan saved: ${partial.done} of ${partial.total} conversations (${partial.reason})`);
    if (parsed.mode === "plan" && partial.progressPath) {
      console.log(`progress file: ${partial.progressPath}`);
      console.log(`rerun to finish: --plan --limit ${LIMIT} --out ${parsed.out} --resume ${partial.progressPath}`);
    }
    process.exitCode = 1;
  } else if (parsed.mode === "plan") {
    if (laneB.rows.length === 0) {
      console.log("plan: nothing to write (0 chat rows)");
    } else {
      const contents = apply.serializePlan(laneB.rows);
      writeFileSync(parsed.out, contents, "utf8");
      const token = apply.fileToken(contents);
      console.log(`plan written: ${laneB.rows.length} rows to ${parsed.out}; token ${token}`);
      console.log(`apply after Nour's yes: --execute --plan-file ${parsed.out} --token ${token}`);
    }
  } else {
    console.log("dry run: nothing written (use --plan --out <file> to write a plan file)");
  }
  await prisma.$disconnect();
}

type Prisma = (typeof import("@/lib/prisma"))["prisma"];
type ApplyModule = typeof import("@/lib/services/people/backfill-apply");

async function execute(prisma: Prisma, contents: string, token: string, apply: ApplyModule) {
  const { Prisma: P } = await import("@prisma/client");
  const { recordInteraction } = await import("@/lib/services/people/record-interaction");
  const { contactRowsOnly } = await import("@/lib/services/people/contact-rows");

  const result = await apply.runApply({
    planFile: contents,
    token,
    deps: {
      // One REPEATABLE READ snapshot for the copy and both counts; a refused copy rolls back.
      backup: () =>
        apply.backupInOneSnapshot(
          {
            inTransaction: (fn) =>
              prisma.$transaction(
                (tx) =>
                  fn({
                    exec: (sql) => tx.$executeRawUnsafe(sql),
                    count: async (table) =>
                      Number(((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${table}`)) as Array<{ n: number }>)[0].n),
                  }),
                { isolationLevel: P.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
              ),
          },
          BACKUP_TABLE,
        ),
      insert: (r) =>
        apply.insertWithinWindow(r, {
          personLive: async (personId) =>
            (await prisma.personProfile.count({ where: { id: personId, deletedAt: null } })) > 0,
          contactsBetween: async (personId, start, end) =>
            contactRowsOnly(
              await prisma.relationshipLedger.findMany({
                where: { personId, createdAt: { gte: start, lte: end } },
                select: { metadata: true },
              }),
            ).length,
          write: async (row) => {
            await recordInteraction({
              personId: row.personId,
              amount: 1,
              note: `interaction reported in chat (${row.interactionKind ?? "other"})`,
              source: "chat",
              at: row.at,
              creditXp: false,
              metadata: {
                auto: true,
                via: "backfill:conversation_digest",
                conversationId: row.conversationId,
                interactionKind: row.interactionKind ?? "other",
                backfillKey: row.backfillKey,
              },
            });
          },
        }),
    },
  });
  const { failures, ...summary } = result as typeof result & { failures?: Array<{ key: string; error: string }> };
  console.log(`execute: ${JSON.stringify(summary)}`);
  if (result.status === "backup_mismatch") {
    console.log("nothing written: the backup copy was rolled back. To rerun: the same --execute line.");
  }
  if (failures && failures.length > 0) {
    console.log(`first failure: ${failures[0].key}: ${failures[0].error}`);
    console.log(
      `rows written are skipped on a rerun. To rerun the failed ones: ALTER TABLE "${BACKUP_TABLE}" RENAME TO "${BACKUP_TABLE}_run1"; then the same --execute line.`,
    );
  }
  if (result.status !== "applied") process.exitCode = 1;
}

main().catch((err) => {
  console.error("people-backfill failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
