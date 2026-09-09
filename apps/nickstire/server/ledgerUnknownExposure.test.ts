/**
 * A STALE RESERVATION AND AN UNKNOWN CHARGE ARE NOT THE SAME THING.
 *
 * sweepStaleReservations (shipped in #2237) released any reservation still
 * `reserved` after 6 hours, so the day's budget stopped being consumed by rows
 * no worker would ever settle. Correct for the case it was written for, and
 * wrong for the case underneath it:
 *
 *   reserve $1.25 -> request reaches the provider -> provider accepts, runs and
 *   BILLS -> our poll times out with no operation handle -> six hours later the
 *   sweep releases the reservation -> our ledger reads $0 for money that is gone.
 *
 * Age is evidence that no WORKER is coming back. It is no evidence at all about
 * what the PROVIDER did. `recordProviderOp` already stamps that distinction —
 * `outcome: "abandoned"` means dispatched and unresolved — and until this guard
 * nothing read it.
 *
 * The guard is deliberately pessimistic in three directions: an unreadable DB,
 * an unparseable payload, and a job it cannot find all resolve toward holding
 * the exposure rather than releasing it. Money is the one place where "we could
 * not check" must never read as "nothing happened".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LEDGER = readFileSync(path.join(__dirname, "services", "generationLedger.ts"), "utf8");
const PIPELINE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");

function sweepBody(): string {
  const start = LEDGER.indexOf("export async function sweepStaleReservations");
  expect(start, "sweepStaleReservations not found").toBeGreaterThan(-1);
  const rest = LEDGER.slice(start);
  const end = rest.indexOf("/** Settle after success");
  expect(end, "end marker not found").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("the sweeper holds money it cannot account for", () => {
  const body = sweepBody();

  it("checks for unresolved provider operations BEFORE releasing", () => {
    const guardAt = body.indexOf("jobHasUnresolvedProviderOps(row.actionId)");
    const releaseAt = body.indexOf('status: "released"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(releaseAt).toBeGreaterThan(-1);
    expect(guardAt, "the guard must precede the release, or it guards nothing").toBeLessThan(releaseAt);
  });

  it("retains rather than releases, and reports what it held", () => {
    expect(body).toContain("retainedUnknownExposure");
    const guard = body.slice(body.indexOf("if (await jobHasUnresolvedProviderOps"));
    // The guarded branch must `continue` — not fall through to the update.
    expect(guard.slice(0, 200)).toContain("continue;");
  });

  it("the held exposure is a WARN, not silent — a growing count is the signal", () => {
    expect(body).toContain("stale reservations RETAINED");
    expect(body).toMatch(/log\.warn\([\s\S]{0,80}RETAINED/);
  });
});

describe("the guard fails toward holding the money", () => {
  const helper = LEDGER.slice(
    LEDGER.indexOf("async function jobHasUnresolvedProviderOps"),
    LEDGER.indexOf("export async function sweepStaleReservations"),
  );

  it("an unreadable database holds the exposure", () => {
    expect(helper).toContain("if (!d) return true");
  });

  it("an unparseable payload holds the exposure", () => {
    expect(helper).toMatch(/catch\s*{\s*\n?\s*return true;/);
  });

  it("it keys on the outcome the pipeline actually records", () => {
    expect(helper).toContain('op?.outcome === "abandoned"');
    // PLANTED CONTROL: if the pipeline stops writing that outcome, this guard
    // silently stops guarding, so pin the producer too.
    expect(PIPELINE).toContain('outcome: "succeeded" | "failed" | "abandoned"');
    expect(PIPELINE).toContain("providerOps.push(");
  });

  it("a job with no provider trouble is still released — the guard is not a blanket hold", () => {
    // `.some(...)` means only an ACTUAL abandoned op retains. Without this the
    // sweeper would hold every reservation forever and the original bug (budget
    // eaten by dead rows) would come straight back.
    expect(helper).toContain(".some((op) => op?.outcome === \"abandoned\")");
    expect(helper).not.toContain("return true; // always");
  });

  it("it only interprets reel-job reservations — other action ids are not guessed at", () => {
    expect(helper).toContain("/^reel_job_(\\d+)$/");
    expect(helper).toContain("if (!m) return false");
  });
});
