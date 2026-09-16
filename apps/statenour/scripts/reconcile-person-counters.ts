/**
 * Reconcile PersonProfile.interactionCount + lastInteraction to the ledger
 * (2026-09-16 · W6, the follow-up #2346 recorded).
 *
 * Measured on prod before this script existed: 27 profiles whose
 * interaction_count summed to 200 against 15 contact rows (23 ledger rows,
 * 8 of them the 2026-05-29 synthetic mention backfill); 20 profiles counted
 * with ZERO rows behind them; the largest lie 69 vs 4, its last_interaction
 * 2026-09-12 against a last contact row of 2026-06-04. The counters had
 * three writers the ledger never saw (chat-mention digest, person.update,
 * profile creation). #2346 made lib/services/people/record-interaction.ts
 * the one writer going forward; this script corrects the past so the
 * invariant holds everywhere:
 *
 *   interactionCount = number of CONTACT rows   (lib/services/people/contact-rows.ts)
 *   lastInteraction  = newest contact row's createdAt, else NULL
 *
 * CORRECTIVE + IDEMPOTENT + RECOMPUTABLE: the ledger (source of truth) is
 * untouched, nothing is deleted, re-running converges to the same state.
 *
 * DRY-RUN by default — prints every delta and returns BEFORE any write.
 * --apply:
 *   1. snapshot the current counters into
 *      _bak_person_profiles_counter_recon_<yyyymmdd> (house pattern; kept
 *      until the change is confirmed good — this project's Neon PITR window
 *      is 6 h, so the table is the durable rollback),
 *   2. per drifted person, inside ONE transaction: advisory lock → re-derive
 *      from that person's rows → write (a log landing mid-run is counted,
 *      never overwritten),
 *   3. re-measure and print the residual drift — anything but 0 exits 1.
 *
 *   railway run --service statenour-web -- pnpm exec tsx scripts/reconcile-person-counters.ts
 *   railway run --service statenour-web -- pnpm exec tsx scripts/reconcile-person-counters.ts --apply
 *
 * Rollback (restores the snapshot's values):
 *   UPDATE person_profiles p
 *      SET interaction_count = b.interaction_count, last_interaction = b.last_interaction
 *     FROM _bak_person_profiles_counter_recon_<yyyymmdd> b
 *    WHERE b.id = p.id;
 */
import { prisma } from "../lib/prisma";
import {
  computeCounterDeltas,
  deriveCounters,
  type CounterDelta,
} from "../lib/services/people/counter-reconcile";
import { lockPerson } from "../lib/services/people/record-interaction";

const APPLY = process.argv.includes("--apply");

function yyyymmdd(d = new Date()): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${mm}${dd}`;
}

function day(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "never";
}

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host;
  } catch {
    return "(no parseable DATABASE_URL)";
  }
}

async function measure(): Promise<CounterDelta[]> {
  const [profiles, rows] = await Promise.all([
    prisma.personProfile.findMany({
      select: { id: true, name: true, interactionCount: true, lastInteraction: true },
      orderBy: { name: "asc" },
    }),
    prisma.relationshipLedger.findMany({
      select: { personId: true, createdAt: true, metadata: true },
    }),
  ]);
  return computeCounterDeltas(profiles, rows);
}

function report(deltas: CounterDelta[]): CounterDelta[] {
  const drifted = deltas.filter((d) => d.changed);
  console.log(`profiles ${deltas.length} · drifted ${drifted.length}`);
  for (const d of drifted) {
    console.log(
      `  ${d.name.padEnd(16)} count ${d.before.interactionCount} → ${d.after.interactionCount}` +
        ` · last ${day(d.before.lastInteraction)} → ${day(d.after.lastInteraction)}`,
    );
  }
  return drifted;
}

async function main(): Promise<void> {
  console.log(`── person counter reconcile (${APPLY ? "APPLY" : "dry-run"}) · db ${dbHost()} ──`);
  const drifted = report(await measure());
  if (!APPLY) {
    console.log("dry-run: nothing written. Pass --apply to reconcile.");
    return;
  }
  if (drifted.length === 0) {
    console.log("already consistent · nothing written.");
    return;
  }

  // Fixed prefix + digits — never built from input.
  const bak = `_bak_person_profiles_counter_recon_${yyyymmdd()}`;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${bak} AS SELECT id, interaction_count, last_interaction, now() AS snapshot_at FROM person_profiles`,
  );
  console.log(`snapshot ${bak} (IF NOT EXISTS · a same-day re-run keeps the first one)`);

  const written = await prisma.$transaction(
    async (tx) => {
      let n = 0;
      for (const d of drifted) {
        await lockPerson(tx, d.id);
        const rows = await tx.relationshipLedger.findMany({
          where: { personId: d.id },
          select: { createdAt: true, metadata: true },
        });
        await tx.personProfile.update({
          where: { id: d.id },
          data: deriveCounters(rows),
          select: { id: true },
        });
        n += 1;
      }
      return n;
    },
    { timeout: 30_000 },
  );
  console.log(`updated ${written} profiles`);

  const residual = report(await measure());
  if (residual.length > 0) {
    console.error(`residual drift ${residual.length} · NOT converged`);
    process.exitCode = 1;
    return;
  }
  console.log("residual drift 0 · converged");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
