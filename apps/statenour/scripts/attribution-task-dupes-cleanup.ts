/**
 * Attribution-escalation duplicate cleanup (job 2026-10-29). DRY RUN by default.
 *
 * Before the bridge was keyed (sender #2789, receipts table applied 2026-10-23)
 * every 2-hourly revenue-reconciliation run opened a "[Nick's Tire] Rule on N
 * ambiguous call<->invoice match(es)" task. Prod SELECT 2026-10-29: 61 such
 * tasks still open, created 2026-09-15 .. 2026-10-06. The standing-obligation
 * slot (lib/services/bridge-receipts.ts `holdStandingSlot`) stops new ones.
 *
 * Plan, printed in both modes (ids and counts only, never task text):
 *   · keeper  = the newest open task of the family; it is retitled count-free
 *               and the standing slot is seeded to it, so the next escalation
 *               reuses it instead of opening one more;
 *   · targets = the other open tasks still untouched in the Inbox: status INBOX,
 *               updated_by 'system', lastTouchedAt still its create time (createTask
 *               stamps it; crons bump only updatedAt), no subtasks;
 *   · kept as-is: anything Nour touched, moved out of the Inbox, or closed.
 *
 * --execute, in ONE transaction (any check failing rolls everything back):
 *   1. CREATE TABLE _bak_task_dupes_20261029 AS the keeper + targets
 *      (fails if it already exists, so a second run cannot overwrite it);
 *   2. backup row count must equal keeper + targets;
 *   3. soft delete the targets (deleted_at = now()), re-checking every
 *      condition in the WHERE; the updated count must equal the plan;
 *   4. retitle the keeper; 5. point the slot at the keeper (insert, or
 *      overwrite a slot a delivery created after the dry run).
 *
 * Restore: UPDATE "Task" t SET deleted_at = b.deleted_at, title = b.title,
 *            updated_by = b.updated_by, "updatedAt" = b."updatedAt"
 *          FROM _bak_task_dupes_20261029 b WHERE t.id = b.id;
 *          DELETE FROM bridge_receipts WHERE idempotency_key = 'v1:obligation.standing:attribution_weak_matches';
 *
 * Run (manager only, prod):  pnpm exec tsx scripts/attribution-task-dupes-cleanup.ts            # dry run
 *                            pnpm exec tsx scripts/attribution-task-dupes-cleanup.ts --execute  # writes
 */

export {};

const EXECUTE = process.argv.includes("--execute");
const BAK = "_bak_task_dupes_20261029";
const SLOT_KEY = "v1:obligation.standing:attribution_weak_matches";
const SLOT_ROUTE = "sync/nour-os:open_loop";
const KEEPER_TITLE = "[Nick's Tire] Rule on ambiguous call↔invoice matches";
const FAMILY = String.raw`^\[Nick's Tire\] Rule on [0-9]+ ambiguous call.invoice match(es)?$`;
const OPEN = ["INBOX", "READY", "DOING", "WAITING"];
const ACTOR = "cleanup-attribution-dupes-20261029";

type Row = { id: string; status: string; created: Date; touched: boolean; children: number };

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`database host : ${host || "(unset)"}`);
  console.log(`mode          : ${EXECUTE ? "EXECUTE" : "DRY RUN (no writes)"}`);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT t.id, t.status::text AS status, t."createdAt" AS created,
           (coalesce(t."lastTouchedAt" - t."createdAt" > interval '1 minute', false)
             OR t.updated_by IS DISTINCT FROM 'system') AS touched,
           (SELECT count(*)::int FROM "Task" c WHERE c.parent_task_id = t.id AND c.deleted_at IS NULL) AS children
      FROM "Task" t
     WHERE t.deleted_at IS NULL AND t.title ~ ${FAMILY}
     ORDER BY t."createdAt" DESC, t.id`;

  const open = rows.filter((r) => OPEN.includes(r.status));
  const keeper = open[0] ?? null;
  const targets = open.filter((r) => r !== keeper && r.status === "INBOX" && !r.touched && r.children === 0);
  const keptAsIs = rows.length - targets.length - (keeper ? 1 : 0);
  const slot = await prisma.bridgeReceipt.findUnique({ where: { idempotencyKey: SLOT_KEY }, select: { resultRef: true } });

  console.log(`family alive  : ${rows.length} (open ${open.length})`);
  console.log(`keeper        : ${keeper ? `${keeper.id} (created ${keeper.created.toISOString()})` : "(none)"}`);
  console.log(`soft-delete   : ${targets.length}`);
  console.log(`left as-is    : ${keptAsIs} (touched, moved out of the Inbox, closed, or with subtasks)`);
  console.log(`slot today    : ${slot ? `points at ${slot.resultRef ?? "(unsettled)"}` : "(none)"}`);
  console.log(`target ids    : ${targets.map((t) => t.id).join(",") || "(none)"}`);

  if (!EXECUTE) {
    console.log("\nDRY RUN: nothing written. Re-run with --execute to apply.");
    await prisma.$disconnect();
    return;
  }
  if (!keeper) throw new Error("no open task in the family; nothing to keep, refusing to run");

  const ids = [keeper.id, ...targets.map((t) => t.id)];
  const targetIds = targets.map((t) => t.id);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE ${BAK} AS SELECT * FROM "Task" WITH NO DATA`);
      await tx.$executeRawUnsafe(`INSERT INTO ${BAK} SELECT * FROM "Task" WHERE id = ANY($1::text[])`, ids);
      const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${BAK}`);
      if (n !== ids.length) throw new Error(`backup has ${n} rows, expected ${ids.length}; rolled back`);

      const deleted = await tx.$executeRaw`
        UPDATE "Task" SET deleted_at = now(), updated_by = ${ACTOR}, "updatedAt" = now()
         WHERE id = ANY(${targetIds}::text[]) AND deleted_at IS NULL AND status::text = 'INBOX'
           AND NOT coalesce("lastTouchedAt" - "createdAt" > interval '1 minute', false)
           AND updated_by = 'system' AND title ~ ${FAMILY}
           AND NOT EXISTS (SELECT 1 FROM "Task" c WHERE c.parent_task_id = "Task".id AND c.deleted_at IS NULL)`;
      if (deleted !== targetIds.length) throw new Error(`soft-deleted ${deleted}, expected ${targetIds.length}; rolled back`);

      const retitled = await tx.$executeRaw`
        UPDATE "Task" SET title = ${KEEPER_TITLE}, updated_by = ${ACTOR}, "updatedAt" = now()
         WHERE id = ${keeper.id} AND deleted_at IS NULL`;
      if (retitled !== 1) throw new Error("keeper changed under us; rolled back");

      await tx.$executeRaw`
        INSERT INTO bridge_receipts (idempotency_key, route, result_ref, first_seen_at, last_seen_at, seen_count)
        VALUES (${SLOT_KEY}, ${SLOT_ROUTE}, ${keeper.id}, now(), now(), 1)
        ON CONFLICT (idempotency_key) DO UPDATE SET result_ref = EXCLUDED.result_ref, last_seen_at = now()`;
    },
    { timeout: 30_000 },
  );

  const [after] = await prisma.$queryRaw<Array<{ alive: number }>>`
    SELECT count(*)::int AS alive FROM "Task" WHERE deleted_at IS NULL AND title ~ ${FAMILY}`;
  console.log(`\nEXECUTED: backup ${BAK} (${ids.length} rows), soft-deleted ${targetIds.length}, keeper retitled, slot points at the keeper.`);
  console.log(`after: counted-title family alive = ${after.alive} (keeper now has the count-free title)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[!] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
