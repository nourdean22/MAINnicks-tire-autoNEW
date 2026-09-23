/**
 * Wall-clock tiers · the daily and briefings tiers run at a fixed ET time of day (2026-09-23)
 *
 * WHY THIS EXISTS. Both tiers used to be a `setInterval` (24 h and 12 h) that
 * starts counting at process boot. Production redeployed the shop server 32
 * times between 2026-09-22 23:53Z and 2026-09-23 13:26Z, so neither timer ever
 * reached its first tick: the tiers ran only from the boot claim in
 * tierStartup.ts, whose time of day is whenever a deploy happened to land. The
 * daily tier ran at 04:29 ET on 2026-09-22. Three of its customer lanes gate
 * on an hour window inside the job — retention 09:00–17:59, declined-work
 * recovery and unpaid-invoice recovery 08:00–19:59 — so on such a day they
 * returned "outside hours" and sent nothing, silently, until the next day's
 * drift happened to land inside the window.
 *
 * THE RULE NOW. Each tier owns named slots on the ET wall clock. A cheap check
 * (every minute, plus once at boot) asks whether a slot is open right now; if
 * it is, the process CLAIMS that slot for this ET day on cron_tier_skip_state
 * and only the claimant runs the tier. A restart therefore cannot move the
 * time of day (the slot, not the boot, sets it) and cannot cause a second run
 * the same day (the claim row is shared across restarts and replicas).
 *
 * THE CLAIM is `claimStartupPass` — the conditional-UPDATE compare-and-swap
 * already proven for boot passes (INSERT IGNORE creates a missing row as the
 * claim; otherwise one UPDATE stamps the row only while `last_run_at` is still
 * older than the slot's opening, computed in SQL). A row can be changed once,
 * so of two containers overlapping during a deploy exactly one fires. The
 * "older than the opening" test carries a margin: a stamp written in the
 * slot's own first seconds must never read as "before the opening" to a
 * caller whose second-rounding or clock differs by a second.
 *
 * DST. Slots are wall-clock minutes compared against the REAL ET clock via
 * Intl, and every slot opens after 03:00, so the skipped (02:00–02:59) and
 * repeated (01:00–01:59) hours never contain a slot opening. The time since
 * the opening is wall-clock minus wall-clock on the same side of the
 * transition, so it is a true elapsed time.
 *
 * NO CLAIM, NO FIRE. When the database is unreachable the check retries a
 * minute later; it never fires unclaimed (the retention re-send the old daily
 * guard existed to prevent). A slot is remembered in memory as settled only
 * after a claim attempt returned an answer.
 *
 * RESIDUAL, stated: the claim is stamped at the START of the pass, so a
 * deploy that kills a pass mid-way loses the rest of that slot for the day —
 * the same P2 posture tierStartup.ts documents, and for the same reason: a
 * reclaim would re-run the jobs that did complete, including sends.
 */
import type { StartupClaim, StartupExecutor } from "./tierStartup";
import { claimStartupPass } from "./tierStartup";

const SHOP_TIMEZONE = "America/New_York";

export interface WallClockSlot {
  /** Claim key suffix; unique across all tiers. */
  key: string;
  /** ET minute of day the slot opens (inclusive). */
  startMin: number;
  /** ET minute of day after which a slot that never ran is abandoned for the day (exclusive). */
  endMin: number;
}

/**
 * daily · 09:30 ET opens every customer lane in the tier: retention (09–17),
 * declined-work and unpaid-invoice recovery (08–19). It stays due until
 * midnight so a day with no live process at 09:30 still gets its backups and
 * reports — those lanes would then self-gate, which is no worse than before.
 *
 * briefings · the tier's own jobs define two slots: nick-morning-brief sends
 * only 06:00–11:59 ET; daily-report waits for 18:00 and daily-wins-digest for
 * 18:00–21:59. 07:00 lands the brief before the shop's day; 19:00 is after
 * the Mon–Sat 18:00 close, so the report covers the whole day. Each window
 * ends where its send jobs would refuse anyway.
 */
const WALL_CLOCK_SLOTS: Readonly<Record<string, readonly WallClockSlot[]>> = {
  daily: [{ key: "daily", startMin: 9 * 60 + 30, endMin: 24 * 60 }],
  briefings: [
    { key: "briefings-am", startMin: 7 * 60, endMin: 12 * 60 },
    { key: "briefings-pm", startMin: 19 * 60, endMin: 22 * 60 },
  ],
};

/** How much older than the slot's opening a stamp must be to count as a previous day's run. */
const SLOT_CLAIM_MARGIN_MS = 5 * 60_000;

export function isWallClockTier(tierName: string): boolean {
  return Object.prototype.hasOwnProperty.call(WALL_CLOCK_SLOTS, tierName);
}

function slotClaimKey(slot: WallClockSlot): string {
  return `wallclock-slot:${slot.key}`;
}

/** The ET calendar day and ms since ET midnight, read from the real ET clock. */
function etWallClock(now: Date): { dayKey: string; msSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Some ICU builds render midnight as hour "24" under hour12:false.
  const hour = parseInt(part("hour"), 10) % 24;
  const msSinceMidnight =
    ((hour * 60 + parseInt(part("minute"), 10)) * 60 + parseInt(part("second"), 10)) * 1000 + now.getMilliseconds();
  return { dayKey: `${part("year")}-${part("month")}-${part("day")}`, msSinceMidnight };
}

interface OpenSlot {
  slot: WallClockSlot;
  dayKey: string;
  /** How long the slot has been open (≥ 0). */
  sinceOpenMs: number;
}

/** The slot of `tierName` that is open at `now`, or null. */
function openSlotAt(tierName: string, now: Date): OpenSlot | null {
  const slots = WALL_CLOCK_SLOTS[tierName];
  if (!slots) return null;
  const { dayKey, msSinceMidnight } = etWallClock(now);
  if (!Number.isFinite(msSinceMidnight)) return null; // unresolvable clock: fail closed
  for (const slot of slots) {
    const openMs = slot.startMin * 60_000;
    if (msSinceMidnight >= openMs && msSinceMidnight < slot.endMin * 60_000) {
      return { slot, dayKey, sinceOpenMs: msSinceMidnight - openMs };
    }
  }
  return null;
}

export type WallClockCheck =
  | "not-open"
  | "settled"
  | "tier-running"
  | "no-db"
  | "claim-error"
  | "lost"
  | "fired";

export interface WallClockRunnerDeps {
  getDb: () => Promise<StartupExecutor | null | undefined>;
  /** Runs the tier's pass. Resolves when the pass ends. */
  runTier: (tierName: string) => Promise<void>;
  isTierRunning: (tierName: string) => boolean;
  log: { info: (msg: string) => void; warn: (msg: string, meta?: unknown) => void };
  claim?: (d: StartupExecutor, key: string, allowanceMs: number) => Promise<StartupClaim>;
}

/**
 * One per process. `check(tier)` is safe to call as often as you like: it
 * touches the database only while a slot is open and not yet settled in this
 * process, i.e. about once per slot per process per day.
 */
export function createWallClockRunner(deps: WallClockRunnerDeps) {
  const claim = deps.claim ?? claimStartupPass;
  const settled = new Set<string>();

  async function check(tierName: string, now: Date = new Date()): Promise<WallClockCheck> {
    const open = openSlotAt(tierName, now);
    if (!open) return "not-open";
    const memo = `${open.slot.key}@${open.dayKey}`;
    if (settled.has(memo)) return "settled";
    // Never claim while a pass is still running: runTier would skip it and the
    // day's slot would be spent on a pass that never happened.
    if (deps.isTierRunning(tierName)) return "tier-running";

    let result: StartupClaim;
    try {
      const d = await deps.getDb();
      if (!d) return "no-db";
      result = await claim(d, slotClaimKey(open.slot), open.sinceOpenMs + SLOT_CLAIM_MARGIN_MS);
    } catch (err) {
      deps.log.warn(`${tierName} wall-clock slot ${open.slot.key}: claim failed — not running, retrying next check`, {
        error: err instanceof Error ? err.message : String(err),
        errorId: "CRON_WALLCLOCK_CLAIM_FAILED",
      });
      return "claim-error";
    }
    settled.add(memo);
    if (!result.claimed) {
      deps.log.info(`${tierName} wall-clock slot ${open.slot.key} ${open.dayKey}: already claimed — not running`);
      return "lost";
    }
    deps.log.info(
      `${tierName} wall-clock slot ${open.slot.key} ${open.dayKey}: claimed ${Math.round(open.sinceOpenMs / 60000)} min after opening — FIRING`,
    );
    await deps.runTier(tierName);
    return "fired";
  }

  return { check };
}

/** How often the wall-clock check runs. A slot fires within this long of opening. */
const WALL_CLOCK_CHECK_MS = 60_000;

/**
 * The timers: one check `bootDelayMs` after boot (so a process that comes up
 * inside an open, unclaimed slot fires without waiting), then every minute.
 * Returns the stop function.
 */
export function startWallClockLoop(
  runner: ReturnType<typeof createWallClockRunner>,
  tierNames: readonly string[],
  opts: { bootDelayMs: number; onError: (tierName: string, err: unknown) => void },
): () => void {
  const tick = () => {
    for (const name of tierNames) {
      runner.check(name).catch((err) => opts.onError(name, err));
    }
  };
  const boot = setTimeout(tick, opts.bootDelayMs);
  const handle = setInterval(tick, WALL_CLOCK_CHECK_MS);
  return () => {
    clearTimeout(boot);
    clearInterval(handle);
  };
}
