/**
 * SIGTERM drain (Q-10) — extracted from _core/index.ts so it can be tested
 * with fake timers and injected dependencies.
 *
 * What it replaced: the handler stopped the timers, then force-exited after a
 * fixed 10 s whatever was still running. On 2026-09-22/23 the shop server
 * deployed 32 times in 13.5 h, and every restart could cut a cron job or an
 * SMS send off mid-run.
 *
 * Now, in order:
 *   1. stop every NEW start at once (HTTP accept, tier timers, the cron drain
 *      flag, the SMS delayed queue, telegram/bridge timers) and hand back held
 *      cron locks — all as before;
 *   2. wait for the work already running — in-flight cron handlers, the SMS
 *      queue cycle, open HTTP requests — up to the grace budget;
 *   3. exit 0 once everything settled, or exit 1 at the budget with a log line
 *      naming what was still running.
 *
 * The grace only helps if the platform waits for it: Railway defaults
 * RAILWAY_DEPLOYMENT_DRAINING_SECONDS to 0 (SIGKILL right after SIGTERM), so
 * the service needs it set above the budget (30 for the 25 s default).
 */

const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;
const MIN_SHUTDOWN_GRACE_MS = 1_000;
const MAX_SHUTDOWN_GRACE_MS = 120_000;

/**
 * NICKSTIRE_SHUTDOWN_GRACE_MS, validated: unset or not a whole number of
 * milliseconds → the default; out of range → clamped. Never throws — a typo
 * in an env var must not turn a deploy into a crash loop.
 */
export function resolveShutdownGraceMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SHUTDOWN_GRACE_MS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_SHUTDOWN_GRACE_MS;
  const n = Number(trimmed);
  return Math.min(MAX_SHUTDOWN_GRACE_MS, Math.max(MIN_SHUTDOWN_GRACE_MS, n));
}

/** Headroom between the end of the grace budget and Railway's SIGKILL ("30 for the 25 s default"). */
const DRAIN_EXIT_MARGIN_MS = 5_000;

export interface DrainCoverage {
  /** Railway's drain window, or null when unset or not a whole number (Railway then uses 0). */
  railwayDrainingSeconds: number | null;
  shutdownGraceMs: number;
  /** True only when the window outlasts the grace budget by the exit margin. */
  covered: boolean;
  note: string;
}

/**
 * Does Railway's drain window cover the grace budget above?
 *
 * RAILWAY_DEPLOYMENT_DRAINING_SECONDS is Railway's setting, not ours, but it is
 * an ordinary service variable, so the process can read it. Nothing did: whether
 * the drain ever got its time was an operator-only fact that no agent or probe
 * could check (the 2026-09-28 audit saw the variable but not its value).
 * /api/version reports this and boot warns when it is short. Unset or
 * unreadable counts as Railway's default of 0, never as covered.
 */
export function resolveDrainCoverage(env: Record<string, string | undefined>): DrainCoverage {
  const shutdownGraceMs = resolveShutdownGraceMs(env.NICKSTIRE_SHUTDOWN_GRACE_MS);
  const raw = env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS?.trim() ?? "";
  const railwayDrainingSeconds = /^\d+$/.test(raw) ? Number(raw) : null;
  const neededSeconds = Math.ceil((shutdownGraceMs + DRAIN_EXIT_MARGIN_MS) / 1000);
  const covered = railwayDrainingSeconds !== null && railwayDrainingSeconds >= neededSeconds;
  let note: string;
  if (railwayDrainingSeconds === null) {
    const state = raw ? "is not a whole number of seconds" : "is unset";
    note = `RAILWAY_DEPLOYMENT_DRAINING_SECONDS ${state}, so Railway uses 0 and kills the process right after SIGTERM; the ${shutdownGraceMs} ms drain needs at least ${neededSeconds} s`;
  } else if (covered) {
    note = `Railway waits ${railwayDrainingSeconds} s after SIGTERM; the ${shutdownGraceMs} ms drain needs ${neededSeconds} s`;
  } else {
    note = `Railway waits only ${railwayDrainingSeconds} s after SIGTERM; the ${shutdownGraceMs} ms drain needs ${neededSeconds} s, so work still running then is killed`;
  }
  return { railwayDrainingSeconds, shutdownGraceMs, covered, note };
}

/** One kind of work the drain waits for. */
export interface DrainSource {
  /** Stable label for the log line, e.g. "cron", "sms-queue", "http". */
  label: string;
  /** What is running right now (one entry per run); empty when idle. */
  pending: () => string[];
  /** Resolves once this source is idle. Must not reject. */
  settled: () => Promise<void>;
}

export interface ShutdownDeps {
  /** Step 1: stop new starts. Each runs once, in order; a throw is logged and the rest still run. */
  stops: Array<{ label: string; run: () => void }>;
  /** Step 2: what to wait for. */
  sources: DrainSource[];
  graceMs: number;
  exit: (code: number) => void;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** Injectable clock; defaults to the global timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/**
 * Build the SIGTERM handler. The returned function is idempotent: a second
 * signal while draining is ignored rather than restarting the budget or
 * exiting early. It resolves once exit() has been called.
 */
export function createGracefulShutdown(deps: ShutdownDeps): () => Promise<void> {
  let started = false;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = deps.now ?? Date.now;

  return async function shutdown(): Promise<void> {
    if (started) {
      deps.log.info("[shutdown] signal received again while draining — ignored");
      return;
    }
    started = true;
    const t0 = now();
    deps.log.info("[shutdown] SIGTERM received — no new work starts; draining in-flight work", { graceMs: deps.graceMs });

    for (const stop of deps.stops) {
      try {
        stop.run();
      } catch (e) {
        deps.log.warn(`[shutdown] ${stop.label} stop failed`, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // A source that throws must not stop the exit below — a shutdown that
    // never calls exit() just waits for the platform's SIGKILL.
    const running = (): string[] =>
      deps.sources.flatMap((s) => {
        try {
          return s.pending().map((p) => `${s.label}:${p}`);
        } catch {
          return [`${s.label}:(unreadable)`];
        }
      });

    const atStart = running();
    if (atStart.length) deps.log.info("[shutdown] waiting for in-flight work", { running: atStart });

    let timer: unknown;
    const drained = await Promise.race([
      Promise.all(deps.sources.map((s) => Promise.resolve().then(() => s.settled()).catch(() => undefined))).then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimer(() => resolve(false), deps.graceMs); }),
    ]);
    if (timer !== undefined) clearTimer(timer);

    if (drained) {
      deps.log.info("[shutdown] drained — exiting 0", { elapsedMs: now() - t0 });
      deps.exit(0);
      return;
    }
    const still = running();
    deps.log.warn(
      `[shutdown] grace budget ${deps.graceMs}ms spent — abandoning still running: ${still.join(", ") || "(unknown)"}`,
      { running: still, elapsedMs: now() - t0, errorId: "SHUTDOWN_DRAIN_TIMEOUT" },
    );
    deps.exit(1);
  };
}

/** The slice of http.Server / ServerResponse the request tracker needs. */
interface RequestEmitter {
  on(event: "request", fn: (req: { method?: string; url?: string }, res: ResponseLike) => void): unknown;
}
interface ResponseLike {
  once(event: "close" | "finish", fn: () => void): unknown;
  getHeader(name: string): unknown;
}

/**
 * Open HTTP requests as a drain source, so an exit that follows a fast cron
 * drain does not cut a webhook or booking POST mid-response (the old fixed
 * 10 s wait gave them that window by accident). Event streams (the admin
 * realtime SSE feeds) never finish by design and are excluded — waiting on
 * them would spend the whole budget on every deploy an admin tab is open.
 */
export function trackHttpRequests(server: RequestEmitter): DrainSource {
  const open = new Map<ResponseLike, string>();
  let waiters: Array<() => void> = [];
  const isStream = (res: ResponseLike) => /^text\/event-stream/i.test(String(res.getHeader("content-type") ?? ""));
  const blocking = () => [...open].filter(([res]) => !isStream(res)).map(([, label]) => label);
  const check = () => {
    if (blocking().length) return;
    const w = waiters; waiters = [];
    for (const fn of w) fn();
  };
  server.on("request", (req, res) => {
    open.set(res, `${req.method ?? "?"} ${(req.url ?? "").split("?")[0]}`);
    const done = () => { open.delete(res); check(); };
    res.once("finish", done);
    res.once("close", done);
  });
  return {
    label: "http",
    pending: blocking,
    settled: () => new Promise<void>((resolve) => { waiters.push(resolve); check(); }),
  };
}

/**
 * Work a handler starts AFTER it has answered (F5, post-merge audit of #2651).
 *
 * "Ack first, then work" handlers — the Vapi end-of-call report, the inbound
 * SMS answer — send their 200 and then run the real work detached. Once the
 * response is sent, trackHttpRequests no longer sees the request, so a SIGTERM
 * in that window exited mid-work: a customer's text acked and never answered,
 * a post-call confirmation lost, and nothing retries because the sender
 * already got its 200. Wrapping the detached promise here makes it one more
 * drain source, waited for inside the same grace budget.
 *
 * Returns the same promise, so a call site keeps its own `.catch`.
 */
let detachedSeq = 0;
const detachedRuns = new Map<number, { label: string; done: Promise<void> }>();

export function trackDetached<T>(label: string, work: Promise<T>): Promise<T> {
  const id = ++detachedSeq;
  const done = work.then(() => undefined, () => undefined).finally(() => { detachedRuns.delete(id); });
  detachedRuns.set(id, { label, done });
  return work;
}

export const detachedWork: DrainSource = {
  label: "detached",
  pending: () => [...detachedRuns.values()].map((r) => r.label),
  settled: async () => {
    // Loop: detached work may start more detached work while we wait.
    while (detachedRuns.size) await Promise.all([...detachedRuns.values()].map((r) => r.done));
  },
};
