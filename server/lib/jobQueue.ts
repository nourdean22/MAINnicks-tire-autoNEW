/**
 * Lightweight In-Process Job Queue
 *
 * No Redis required. Jobs are processed in-memory with retries.
 * Limitation: jobs are lost on server restart (acceptable for v1).
 *
 * Usage:
 *   jobQueue.register('send-sms', async (data) => { ... });
 *   await jobQueue.add('send-sms', { to: '...', body: '...' });
 */

import { createLogger } from "./logger";

const log = createLogger("job-queue");

interface Job {
  id: string;
  name: string;
  data: unknown;
  retries: number;
  maxRetries: number;
  priority: number;
  state: "waiting" | "active" | "completed" | "failed";
  error?: string;
  createdAt: number;
  completedAt?: number;
  delay: number;
}

type JobHandler = (data: unknown) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const jobs = new Map<string, Job>();
let jobCounter = 0;
let processing = false;

function generateId(): string {
  return `job_${Date.now()}_${++jobCounter}`;
}

// ─── Register a job handler ─────────────────────
function register(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
  log.debug(`Job handler registered: ${name}`);
}

// ─── Add a job to the queue ─────────────────────
async function add(
  name: string,
  data: unknown,
  options?: { delay?: number; retries?: number; priority?: number }
): Promise<string> {
  const id = generateId();
  const job: Job = {
    id,
    name,
    data,
    retries: 0,
    maxRetries: options?.retries ?? 3,
    priority: options?.priority ?? 0,
    state: "waiting",
    createdAt: Date.now(),
    delay: options?.delay ?? 0,
  };

  jobs.set(id, job);
  log.debug(`Job queued: ${name}`, { id, delay: job.delay });

  // Process after delay (or immediately)
  if (job.delay > 0) {
    setTimeout(() => processNext(), job.delay);
  } else {
    queueMicrotask(() => processNext());
  }

  return id;
}

// ─── Process next waiting job ───────────────────
async function processNext(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    // Find next waiting job (sorted by priority, then creation time)
    const waiting = Array.from(jobs.values())
      .filter((j) => j.state === "waiting" && j.createdAt + j.delay <= Date.now())
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    if (waiting.length === 0) {
      processing = false;
      return;
    }

    const job = waiting[0];
    const handler = handlers.get(job.name);

    if (!handler) {
      log.error(`No handler for job: ${job.name}`, { id: job.id });
      job.state = "failed";
      job.error = `No handler registered for '${job.name}'`;
      processing = false;
      return;
    }

    job.state = "active";

    try {
      await handler(job.data);
      job.state = "completed";
      job.completedAt = Date.now();
      log.debug(`Job completed: ${job.name}`, { id: job.id, duration: job.completedAt - job.createdAt });
    } catch (err) {
      job.retries++;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (job.retries >= job.maxRetries) {
        job.state = "failed";
        job.error = errMsg;
        log.error(`Job failed permanently: ${job.name}`, { id: job.id, retries: job.retries, error: errMsg });
      } else {
        // Exponential backoff: 1s, 5s, 30s
        const backoff = [1000, 5000, 30000][Math.min(job.retries - 1, 2)];
        job.state = "waiting";
        job.delay = backoff;
        job.createdAt = Date.now(); // Reset for delay calculation
        log.warn(`Job retry: ${job.name}`, { id: job.id, attempt: job.retries, backoff });
        setTimeout(() => processNext(), backoff);
      }
    }
  } finally {
    processing = false;
  }

  // Process more if available
  const moreWaiting = Array.from(jobs.values()).some((j) => j.state === "waiting");
  if (moreWaiting) {
    queueMicrotask(() => processNext());
  }
}

// ─── Get job status ─────────────────────────────
function getStatus(jobId: string): { state: string; error?: string } | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { state: job.state, error: job.error };
}

// ─── Get queue stats ────────────────────────────
function getStats(): { waiting: number; active: number; completed: number; failed: number } {
  const all = Array.from(jobs.values());
  return {
    waiting: all.filter((j) => j.state === "waiting").length,
    active: all.filter((j) => j.state === "active").length,
    completed: all.filter((j) => j.state === "completed").length,
    failed: all.filter((j) => j.state === "failed").length,
  };
}

// ─── Cleanup old completed/failed jobs (call periodically) ──
function cleanup(maxAge = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAge;
  let removed = 0;
  for (const [id, job] of jobs) {
    if ((job.state === "completed" || job.state === "failed") && (job.completedAt || job.createdAt) < cutoff) {
      jobs.delete(id);
      removed++;
    }
  }
  if (removed > 0) log.debug(`Cleaned up ${removed} old jobs`);
  return removed;
}

// Auto-cleanup completed/failed jobs every 10 minutes (prevents unbounded growth)
setInterval(() => {
  cleanup(2 * 60 * 60 * 1000); // Remove completed/failed jobs older than 2 hours
  // Hard cap: if still over 10k jobs, purge oldest completed first
  if (jobs.size > 10000) {
    const completed = Array.from(jobs.entries())
      .filter(([, j]) => j.state === "completed" || j.state === "failed")
      .sort((a, b) => (a[1].completedAt || a[1].createdAt) - (b[1].completedAt || b[1].createdAt));
    const toRemove = jobs.size - 5000;
    for (let i = 0; i < Math.min(toRemove, completed.length); i++) {
      jobs.delete(completed[i][0]);
    }
  }
}, 10 * 60 * 1000);

export const jobQueue = {
  register,
  add,
  getStatus,
  getStats,
  cleanup,
};
