/**
 * Ollama Cloud slot scheduler (2026-08-06 directive).
 *
 * Ollama Pro allows three concurrent cloud models. This makes those slots
 * deliberate instead of accidental: every Ollama-bound invokeLLM call
 * acquires a slot with a priority class, background work yields to live
 * work, and telemetry records who waited.
 *
 * Priority classes (directive):
 *   P0 — live production assistance
 *   P1 — shadow evaluation
 *   P2 — scheduled benchmarks / cage matches   (default)
 *   P3 — historical backgrading and backfill
 *   P4 — speculative experiments
 *
 * SOFT RESERVATION, not preemption: background work (P2+) may hold at most
 * SLOTS-1 concurrent slots, so one slot is always free for a P0/P1 arrival.
 * Cancelling an in-flight cloud call mid-generation is deliberately out of
 * scope — a background job yields by queuing, never by being killed.
 *
 * Pure in-process module: no timers, no clock reads beyond wait bookkeeping,
 * fully unit-testable.
 */

export type SlotPriority = 0 | 1 | 2 | 3 | 4;

const SLOTS = Math.max(1, parseInt(process.env.OLLAMA_MAX_CONCURRENCY || "3", 10) || 3);
/** P2+ is background; it may never occupy the last free slot. */
const BACKGROUND_CAP = Math.max(1, SLOTS - 1);
const BACKGROUND_MIN_PRIORITY = 2;

interface Waiter {
  priority: SlotPriority;
  seq: number;
  grant: (release: () => void) => void;
}

let held = 0;
let backgroundHeld = 0;
let seqCounter = 0;
const queue: Waiter[] = [];

const telemetry = {
  granted: [0, 0, 0, 0, 0],
  queued: [0, 0, 0, 0, 0],
  maxQueueDepth: 0,
};

function isBackground(priority: SlotPriority): boolean {
  return priority >= BACKGROUND_MIN_PRIORITY;
}

function canGrant(priority: SlotPriority): boolean {
  if (held >= SLOTS) return false;
  if (isBackground(priority) && backgroundHeld >= BACKGROUND_CAP) return false;
  return true;
}

function makeRelease(priority: SlotPriority): () => void {
  let released = false;
  return () => {
    if (released) return; // double-release must never double-free a slot
    released = true;
    held--;
    if (isBackground(priority)) backgroundHeld--;
    pump();
  };
}

function grantNow(priority: SlotPriority): () => void {
  held++;
  if (isBackground(priority)) backgroundHeld++;
  telemetry.granted[priority]++;
  return makeRelease(priority);
}

function pump(): void {
  // Highest priority first; FIFO within a class. A background waiter that
  // cannot take the reserved slot is skipped WITHOUT blocking a grantable
  // waiter behind it.
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (let i = 0; i < queue.length; ) {
    const w = queue[i];
    if (canGrant(w.priority)) {
      queue.splice(i, 1);
      w.grant(grantNow(w.priority));
    } else if (held >= SLOTS) {
      return; // nothing can be granted until a release
    } else {
      i++; // background blocked by the reservation; a P0/P1 behind it may still pass
    }
  }
}

/**
 * Acquire a slot. Resolves to a release function — call it exactly once in a
 * finally block. Waits indefinitely by default: a background job's correct
 * behavior under pressure is patience, and a hung provider call is bounded
 * by invokeLLM's own timeout, not by the scheduler.
 *
 * `maxWaitMs` (2026-10-09, opt-in) caps the wait for callers that run under
 * their own deadline: the prompt experiment computes each call's timeout from
 * the budget left BEFORE the call, so a seed queued here past that budget
 * would start its fetch with a stale timeout and could outlive the job. A
 * capped waiter that is not granted in time is removed from the queue and
 * rejects with a timeout-shaped error; a grant that lands first wins.
 */
export function acquireOllamaSlot(priority: SlotPriority = 2, maxWaitMs?: number): Promise<() => void> {
  if (canGrant(priority)) {
    return Promise.resolve(grantNow(priority));
  }
  telemetry.queued[priority]++;
  return new Promise((resolvePromise, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiter: Waiter = {
      priority,
      seq: seqCounter++,
      grant: (release) => {
        if (timer !== undefined) clearTimeout(timer);
        resolvePromise(release);
      },
    };
    queue.push(waiter);
    telemetry.maxQueueDepth = Math.max(telemetry.maxQueueDepth, queue.length);
    if (maxWaitMs !== undefined && Number.isFinite(maxWaitMs)) {
      timer = setTimeout(() => {
        const i = queue.indexOf(waiter);
        if (i === -1) return; // granted first; the grant cleared this timer, this is a stale fire
        queue.splice(i, 1);
        reject(new Error(`Ollama slot wait timed out after ${Math.max(0, Math.floor(maxWaitMs))} ms (priority P${priority}, queue ${queue.length})`));
      }, Math.max(0, maxWaitMs));
    }
  });
}

/** Read-only snapshot for readouts and tests. */
export function schedulerSnapshot() {
  return {
    slots: SLOTS,
    backgroundCap: BACKGROUND_CAP,
    held,
    backgroundHeld,
    queueDepth: queue.length,
    granted: [...telemetry.granted],
    queued: [...telemetry.queued],
    maxQueueDepth: telemetry.maxQueueDepth,
  };
}

/** Test-only: reset all state. Never call from production code. */
export function __resetSchedulerForTests(): void {
  held = 0;
  backgroundHeld = 0;
  seqCounter = 0;
  queue.length = 0;
  telemetry.granted = [0, 0, 0, 0, 0];
  telemetry.queued = [0, 0, 0, 0, 0];
  telemetry.maxQueueDepth = 0;
}
