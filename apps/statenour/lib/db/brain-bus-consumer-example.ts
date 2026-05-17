/**
 * Brain-bus subscriber example · v8.10 BATCH 57 · Apr 29.
 *
 * Concrete consumer of the v8.4 brain-bus + v8.7 entity-audit
 * publisher. Demonstrates the "react to mutations without polling"
 * pattern by listening for `entity_audit` events and counting
 * recent activity per entity-type into a rolling brain-memory.
 *
 * Why a CONCRETE example here:
 *   1. Documents the subscribe() contract for future consumers
 *   2. Lets the in-process audit pipeline self-test by dogfooding
 *   3. Makes Phase 2B's value visible: a long-lived listener can
 *      maintain derived state in real-time, no polling, no Vercel
 *      cron slot
 *
 * NOT auto-started (no instrumentation hook in Next 16 App Router
 * that's stable for this). Caller wires it up in:
 *   · A long-running Node process, OR
 *   · An on-demand admin endpoint that runs the consumer for N min,
 *     useful for backfilling derived state.
 *
 * Two helpers shipped:
 *   · `startEntityAuditCounter(opts)` — long-lived subscriber,
 *     returns an unsubscribe handle.
 *   · `runForDuration(opts)` — convenience for short-lived runs
 *     (admin endpoints / smoke tests).
 *
 * Storage: the per-entity-type rolling counter is summarized into
 * a BrainMemory row category="bus_consumer_counter" key="<type>"
 * every flush interval (default 60s). One row per entity-type;
 * upsert pattern keeps it bounded.
 */

import { subscribe, type BusEnvelope } from "@/lib/db/brain-bus";
import { prisma } from "@/lib/prisma";

interface AuditEnvelope {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  reason: string | null;
  source: string | null;
}

export interface CounterOptions {
  /** Flush rolling counts to BrainMemory every N ms. Default 60s. */
  flushIntervalMs?: number;
  /** Cap the rolling window at N events per type. Default 100. */
  maxPerType?: number;
}

/**
 * Start the consumer. Returns an unsubscribe handle that ALSO clears
 * the periodic flush timer. The caller is responsible for keeping
 * the process alive — this just wires the listener.
 */
export async function startEntityAuditCounter(
  opts: CounterOptions = {},
): Promise<() => Promise<void>> {
  const flushIntervalMs = opts.flushIntervalMs ?? 60_000;
  const maxPerType = opts.maxPerType ?? 100;

  // Rolling buckets, never larger than maxPerType per key.
  const counts = new Map<string, number>();
  const lastSeenAction = new Map<string, string>();
  const lastSeenAt = new Map<string, number>();

  const unsubscribe = await subscribe<AuditEnvelope>(
    "entity_audit",
    (env: BusEnvelope<AuditEnvelope>) => {
      const t = env.payload.entityType;
      const c = counts.get(t) ?? 0;
      counts.set(t, Math.min(c + 1, maxPerType));
      lastSeenAction.set(t, env.payload.action);
      lastSeenAt.set(t, new Date(env.at).getTime());
    },
  );

  // Flush rolling state to BrainMemory periodically.
  const timer = setInterval(() => {
    void flushCountsToBrainMemory(counts, lastSeenAction, lastSeenAt);
  }, flushIntervalMs);

  return async () => {
    clearInterval(timer);
    await unsubscribe();
    // Final flush so we don't lose the last window of state.
    await flushCountsToBrainMemory(counts, lastSeenAction, lastSeenAt);
  };
}

/**
 * Run the consumer for a fixed duration, then clean up. Use for
 * one-shot derived-state backfills + smoke tests.
 */
export async function runForDuration(
  durationMs: number,
  opts: CounterOptions = {},
): Promise<void> {
  const stop = await startEntityAuditCounter(opts);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await stop();
}

async function flushCountsToBrainMemory(
  counts: Map<string, number>,
  lastSeenAction: Map<string, string>,
  lastSeenAt: Map<string, number>,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [entityType, count] of counts.entries()) {
    if (count === 0) continue;
    const action = lastSeenAction.get(entityType) ?? "unknown";
    const seenAtMs = lastSeenAt.get(entityType) ?? Date.now();
    tasks.push(
      upsertCounter(
        entityType,
        count,
        action,
        new Date(seenAtMs).toISOString(),
      ).catch((err: unknown) => {
        console.warn(`[bus-consumer] flush ${entityType} failed:`, err);
      }),
    );
  }
  await Promise.all(tasks);
}

async function upsertCounter(
  entityType: string,
  count: number,
  lastAction: string,
  lastSeenAt: string,
): Promise<void> {
  const content = `Real-time count: ${count} ${entityType} mutation(s) since process start. Last action: ${lastAction} at ${lastSeenAt}.`;
  const metadata = { entityType, count, lastAction, lastSeenAt };
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "bus_consumer_counter", key: entityType } },
  });
  if (existing) {
    await prisma.brainMemory.update({
      where: { id: existing.id },
      data: {
        content,
        seenCount: existing.seenCount + 1,
        metadata: metadata as unknown as Parameters<typeof prisma.brainMemory.update>[0]["data"]["metadata"],
      },
    });
  } else {
    await prisma.brainMemory.create({
      data: {
        category: "bus_consumer_counter",
        key: entityType,
        content,
        confidence: 0.7,
        source: "bus:entity_audit",
        metadata: metadata as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  }
}
