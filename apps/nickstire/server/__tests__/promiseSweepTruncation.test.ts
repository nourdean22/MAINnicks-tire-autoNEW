/**
 * The overdue sweep must not report its PAGE SIZE as the number of open
 * promises.
 *
 * THE READER WAS WRITTEN FOR A DIFFERENT WRITER. sweepOverduePromises examines
 * `listOpenPromises(200)` and used to report `${open.length} open`. While every
 * promise was typed by hand that was harmless — the table never came close to
 * 200 rows, so the page size and the total were always the same number.
 *
 * Voice capture changes the writer: a promise is now created per qualifying
 * call. The open set can genuinely exceed the page, and at that point the cron
 * line an operator reads to judge ledger health would say "200 open" when there
 * were 500. Not a truncation warning — a wrong total wearing the costume of a
 * measurement.
 *
 * WHAT IS NOT BROKEN, and is asserted here so nobody "fixes" it: the queue
 * degrades gracefully. ORDER BY due_at ASC keeps the most-overdue inside the
 * examined page, and rows leave the open set as they flip to missed, so later
 * runs reach the rest. The defect was only ever the instrument.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../db", () => ({ getDb: async () => ({ execute }) }));
vi.mock("../services/opportunityQueue", () => ({
  upsertOpportunity: vi.fn(async () => "created"),
  transitionOpportunity: vi.fn(async () => undefined),
}));

const asRows = (rows: unknown[]) => [rows, []];

/** An open promise that is NOT yet due, so the sweep does no escalation work. */
function futurePromise(i: number) {
  return {
    id: `p${i}`,
    promise_type: "callback",
    customer_name: null,
    customer_phone: null,
    promised_action: "call back",
    owner: "Front Counter",
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    status: "open",
    kept_at: null,
    kept_evidence: null,
    escalated_at: null,
    created_by: "voice-agent",
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => execute.mockReset());
afterEach(() => vi.restoreAllMocks());

async function sweep() {
  return (await import("../services/promiseLedger")).sweepOverduePromises;
}

describe("the sweep reports the TOTAL, not the page it looked at", () => {
  it("discloses that more open promises exist than were examined", async () => {
    const sweepOverduePromises = await sweep();
    execute
      .mockResolvedValueOnce(asRows(Array.from({ length: 200 }, (_, i) => futurePromise(i)))) // the page
      .mockResolvedValueOnce(asRows([{ n: 500 }]));                                            // the real total

    const res = await sweepOverduePromises();

    expect(res.details).toContain("500 open");
    expect(res.details).toMatch(/only the 200 most overdue examined/i);
    // The precise regression: the page size must never stand in for the total.
    expect(res.details).not.toMatch(/^200 open/);
  });

  it("says plainly that the rest are not lost, only deferred", async () => {
    // An operator who reads "500 open, 200 examined" and cannot tell whether
    // the other 300 are queued or dropped will escalate a non-incident.
    const sweepOverduePromises = await sweep();
    execute
      .mockResolvedValueOnce(asRows(Array.from({ length: 200 }, (_, i) => futurePromise(i))))
      .mockResolvedValueOnce(asRows([{ n: 500 }]));

    const res = await sweepOverduePromises();
    expect(res.details).toMatch(/wait for the next|the rest/i);
  });

  it("adds no truncation noise when the page covers everything", async () => {
    const sweepOverduePromises = await sweep();
    execute
      .mockResolvedValueOnce(asRows([futurePromise(1), futurePromise(2)]))
      .mockResolvedValueOnce(asRows([{ n: 2 }]));

    const res = await sweepOverduePromises();
    expect(res.details).toContain("2 open");
    expect(res.details).not.toMatch(/most overdue examined/i);
  });

  it("a FAILED count says unknown rather than substituting the page size", async () => {
    // The empty-vs-error rule applied to the instrument itself: if the count
    // cannot be taken, the honest answer is "unknown", never the page length
    // dressed up as a total.
    const sweepOverduePromises = await sweep();
    execute
      .mockResolvedValueOnce(asRows([futurePromise(1), futurePromise(2)]))
      .mockRejectedValueOnce(new Error("count blew up"));

    const res = await sweepOverduePromises();
    expect(res.details).toMatch(/total unknown/i);
    expect(res.details).not.toMatch(/\b2 open\b/);
  });

  it("POSITIVE CONTROL: the three outcomes are genuinely different strings", async () => {
    // A details line hardcoded to mention "open" would satisfy each assertion
    // above in isolation.
    const sweepOverduePromises = await sweep();
    const run = async (total: unknown, fail = false) => {
      execute.mockReset();
      const page = execute.mockResolvedValueOnce(asRows([futurePromise(1), futurePromise(2)]));
      if (fail) page.mockRejectedValueOnce(new Error("x"));
      else page.mockResolvedValueOnce(asRows([{ n: total }]));
      return (await sweepOverduePromises()).details;
    };

    const exact = await run(2);
    const truncated = await run(99);
    const unknown = await run(null, true);

    expect(new Set([exact, truncated, unknown]).size).toBe(3);
  });

  it("an empty ledger still short-circuits before counting", async () => {
    // Guards against the count becoming an unconditional second query on every
    // cron tick for a table with nothing in it.
    const sweepOverduePromises = await sweep();
    execute.mockResolvedValueOnce(asRows([]));
    const res = await sweepOverduePromises();
    expect(res.details).toBe("no open promises");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
