/**
 * Tier startup claim · a tier whose last run is an interval old fires at boot (2026-09-22)
 *
 * WHAT WAS WRONG. Only heartbeat, pulse and daily fired at boot; hourly and
 * briefings waited for a `setInterval` that starts counting at process boot.
 * With deploys under two hours apart — thirteen on 2026-09-22 — the hourly
 * tier never reached its first tick: last run 12:29Z, still silent at 20:00Z.
 *
 * WHAT THIS PINS. The boot pass is CLAIMED by one conditional UPDATE (or by
 * creating the missing row) — the review of #2516 showed a SELECT-then-run
 * lets two booting replicas both fire. The claim is driven through a fake
 * executor that renders the real drizzle query, so the test sees the SQL the
 * driver would: the WHERE clause, the bound allowance, the result shape.
 * Then the decision/log line, then that the scheduler wires the claim in
 * front of `runTier` (comment-stripped).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimStartupPass, describeStartup, readLastRunAgeMs, startupAllowanceMs, type StartupExecutor } from "./tierStartup";

const H = 3600_000;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Render a drizzle `sql` object the way the driver would: text with `?` and the bound values in order. */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join(""); // StringChunk
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

type Step = { match: RegExp; result: unknown };
function fakeDb(script: Step[]) {
  const issued: Array<{ text: string; params: unknown[] }> = [];
  const db: StartupExecutor = {
    async execute(q) {
      const r = render(q);
      issued.push(r);
      const step = script.find((s) => s.match.test(r.text));
      if (!step) throw new Error(`unexpected query: ${r.text}`);
      return step.result;
    },
  };
  return { db, issued };
}
/** mysql2's answer to a write: [ResultSetHeader, FieldPacket[]]. */
const header = (affectedRows: number) => [{ affectedRows, insertId: 0, warningStatus: 0 }, []];

describe("claimStartupPass — the row can be changed once, so one process fires", () => {
  it("the 2026-09-22 case: hourly row 7.5 h old → the stamp UPDATE changes the row → claimed", async () => {
    const { db, issued } = fakeDb([
      { match: /^INSERT IGNORE INTO cron_tier_skip_state/, result: header(0) },
      { match: /^UPDATE cron_tier_skip_state/, result: header(1) },
    ]);
    expect(await claimStartupPass(db, "hourly", 2 * H)).toEqual({ claimed: true, via: "stamped" });
    const update = issued[1];
    expect(update.text).toBe(
      "UPDATE cron_tier_skip_state SET last_run_at = NOW(), updated_at = NOW() WHERE tier_name = ? AND (last_run_at IS NULL OR TIMESTAMPDIFF(SECOND, last_run_at, NOW()) >= ?)",
    );
    expect(update.params).toEqual(["hourly", 7200]);
  });

  it("not due: the UPDATE changes nothing → not claimed (the interval timer owns the tier)", async () => {
    const { db } = fakeDb([
      { match: /^INSERT IGNORE/, result: header(0) },
      { match: /^UPDATE/, result: header(0) },
    ]);
    expect(await claimStartupPass(db, "hourly", 2 * H)).toEqual({ claimed: false, via: "not-due" });
  });

  it("never ran: creating the state row IS the claim — no UPDATE is issued", async () => {
    const { db, issued } = fakeDb([{ match: /^INSERT IGNORE/, result: header(1) }]);
    expect(await claimStartupPass(db, "briefings", 12 * H)).toEqual({ claimed: true, via: "created" });
    expect(issued).toHaveLength(1);
    expect(issued[0].text).toBe(
      "INSERT IGNORE INTO cron_tier_skip_state (tier_name, consecutive_skips, last_run_at, updated_at) VALUES (?, 0, NOW(), NOW())",
    );
    expect(issued[0].params).toEqual(["briefings"]);
  });

  it("a second replica: the row was just created by the first → INSERT ignored, UPDATE sees age 0 → not claimed", async () => {
    const { db } = fakeDb([
      { match: /^INSERT IGNORE/, result: header(0) },
      { match: /^UPDATE/, result: header(0) },
    ]);
    expect((await claimStartupPass(db, "briefings", 12 * H)).claimed).toBe(false);
  });

  it("daily binds its 20 h allowance; every other tier binds its own interval", async () => {
    expect(startupAllowanceMs("daily", 24 * H)).toBe(20 * H);
    expect(startupAllowanceMs("hourly", 2 * H)).toBe(2 * H);
    expect(startupAllowanceMs("heartbeat", 5 * 60_000)).toBe(5 * 60_000);
    const { db, issued } = fakeDb([
      { match: /^INSERT IGNORE/, result: header(0) },
      { match: /^UPDATE/, result: header(1) },
    ]);
    await claimStartupPass(db, "daily", startupAllowanceMs("daily", 24 * H));
    expect(issued[1].params).toEqual(["daily", 72000]);
  });

  it("POSITIVE CONTROL for the result shape: an unwrapped ResultSetHeader counts too, and a missing header is 0", async () => {
    const unwrapped = fakeDb([{ match: /^INSERT IGNORE/, result: { affectedRows: 1 } }]);
    expect((await claimStartupPass(unwrapped.db, "hourly", 2 * H)).claimed).toBe(true);
    const empty = fakeDb([
      { match: /^INSERT IGNORE/, result: undefined },
      { match: /^UPDATE/, result: [] },
    ]);
    expect((await claimStartupPass(empty.db, "hourly", 2 * H)).claimed).toBe(false);
  });
});

describe("readLastRunAgeMs — informational, computed in SQL, never from a driver-parsed TIMESTAMP", () => {
  it("maps the SQL age (seconds, possibly a string) to ms; no row or NULL age → null", async () => {
    const aged = fakeDb([{ match: /^SELECT TIMESTAMPDIFF\(SECOND, last_run_at, NOW\(\)\) AS ageSec FROM cron_tier_skip_state WHERE tier_name = \?$/, result: [[{ ageSec: "29144" }], []] }]);
    expect(await readLastRunAgeMs(aged.db, "hourly")).toBe(29_144_000);
    const none = fakeDb([{ match: /^SELECT/, result: [[], []] }]);
    expect(await readLastRunAgeMs(none.db, "hourly")).toBeNull();
    const nul = fakeDb([{ match: /^SELECT/, result: [[{ ageSec: null }], []] }]);
    expect(await readLastRunAgeMs(nul.db, "hourly")).toBeNull();
  });
});

describe("describeStartup — the claim decides; the age only words the log line", () => {
  const base = { tierName: "hourly", allowanceMs: 2 * H };

  it("claimed by stamp → FIRING, and the line carries the age against the allowance", () => {
    const d = describeStartup({ ...base, claim: { claimed: true, via: "stamped" }, lastRunAgeMs: 7.5 * H });
    expect(d.fire).toBe(true);
    expect(d.reason).toBe("claimed the boot pass — last run 450 min ago ≥ allowance 120 min");
  });

  it("claimed by creating the row → FIRING as a never-ran tier", () => {
    const d = describeStartup({ ...base, claim: { claimed: true, via: "created" }, lastRunAgeMs: null });
    expect(d.fire).toBe(true);
    expect(d.reason).toContain("never ran");
  });

  it("not claimed because not due → skip, the interval timer owns it", () => {
    const d = describeStartup({ ...base, claim: { claimed: false, via: "not-due" }, lastRunAgeMs: 0.5 * H });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("last run 30 min ago < allowance 120 min — the interval timer owns it");
  });

  it("not claimed although due → another process won the row; say so, do not fire", () => {
    const d = describeStartup({ ...base, claim: { claimed: false, via: "not-due" }, lastRunAgeMs: 7.5 * H });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain("another process claimed the pass first");
  });

  it("NO CLAIM, NO FIRE: a database that cannot be reached does not fire the daily tier unclaimed", () => {
    const d = describeStartup({ tierName: "daily", allowanceMs: 20 * H, claim: null, lastRunAgeMs: null, claimError: "connect ETIMEDOUT" });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("could not claim (connect ETIMEDOUT) — no claim, no fire; the interval timer owns it");
  });
});

describe("the scheduler wires the claim in front of runTier for EVERY tier", () => {
  const src = stripComments(readFileSync(resolve(__dirname, "./scheduler.ts"), "utf8"));

  it("claims, describes, and only then runs — no SELECT-then-run, no hard-coded boot list", () => {
    const claimAt = src.indexOf("claim = await claimStartupPass(d, tier.name, allowanceMs)");
    const describeAt = src.indexOf("const decision = describeStartup({ tierName: tier.name, allowanceMs, claim, lastRunAgeMs, claimError })");
    const gateAt = src.indexOf("if (!decision.fire) return;");
    const runAt = src.indexOf("runTier(tier).catch(err => log.error(`Tier ${tier.name} startup failed:`");
    expect(claimAt).toBeGreaterThan(0);
    expect(describeAt).toBeGreaterThan(claimAt);
    expect(gateAt).toBeGreaterThan(describeAt);
    expect(runAt).toBeGreaterThan(gateAt);
    expect(src).not.toContain("shouldFireOnStartup");
    expect(src).not.toContain('idx <= 1 || tier.name === "daily"');
  });

  it("the read is informational: a failed read still lets the claim run, a failed claim never fires", () => {
    const block = src.slice(src.indexOf("const allowanceMs = startupAllowanceMs(tier.name, tier.intervalMs)"), src.indexOf("}, stagger);"));
    // the read has its own try so it cannot pre-empt the claim
    expect(block).toMatch(/try \{\s*lastRunAgeMs = await readLastRunAgeMs\(d, tier\.name\);\s*\} catch/);
    // and the claim error is what the decision sees
    expect(block).toContain("claimError = e instanceof Error ? e.message : String(e)");
  });
});
