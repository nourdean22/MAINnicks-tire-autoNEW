/**
 * reconcileExpectedArrivals applies the one-to-one plan, and reads the unique
 * index's rejection as "already claimed" rather than as a failure.
 *
 * The planner's decisions are covered in arrivalReconciliationPlan.test.ts.
 * These tests are about the SEAM: the statements the service actually issues
 * against the database, inspected as the chunks drizzle would send.
 *
 *   - the candidate SELECT excludes invoices something already claimed;
 *   - one UPDATE per DISTINCT invoice, never one per eligible row;
 *   - same-visit siblings are closed as `cancelled` with a width-guarded note;
 *   - ER_DUP_ENTRY on a claim is counted, not thrown (0126 doing its job);
 *   - an unrelated failure keeps the cron's best-effort contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../db", () => ({ getDb: async () => ({ execute }) }));

/** Capture the SQL text drizzle would send, across its chunk representation. */
function sqlTextOf(call: unknown[]): string {
  const q = call[0] as { queryChunks?: unknown[] } | undefined;
  const chunks = q?.queryChunks ?? [];
  return chunks
    .map((c) => {
      const v = c as { value?: unknown };
      return Array.isArray(v?.value) ? v.value.join("") : "";
    })
    .join(" ");
}

const asRows = (rows: unknown[]) => [rows, []];
const affected = (n: number) => [{ affectedRows: n }, []];

/** Three "coming today" rows for one customer, one Wednesday invoice. */
const THREE_ROWS_ONE_INVOICE = [
  { arrivalId: 1, expectedDate: "2026-09-21", createdTs: 1000, invoiceId: 500, invoiceDate: "2026-09-23" },
  { arrivalId: 2, expectedDate: "2026-09-22", createdTs: 2000, invoiceId: 500, invoiceDate: "2026-09-23" },
  { arrivalId: 3, expectedDate: "2026-09-23", createdTs: 3000, invoiceId: 500, invoiceDate: "2026-09-23" },
];

beforeEach(() => execute.mockReset());
afterEach(() => vi.restoreAllMocks());

async function subject() {
  return (await import("../services/expectedArrivals")).reconcileExpectedArrivals;
}

describe("the candidate query", () => {
  it("excludes invoices that are already claimed, and formats dates in SQL", async () => {
    const reconcile = await subject();
    execute.mockResolvedValueOnce(asRows([]));
    await reconcile();
    const sql = sqlTextOf(execute.mock.calls[0]);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/claimed\.reconciledInvoiceId = i\.id/);
    expect(sql).toMatch(/DATE_FORMAT\(ea\.expectedDate/);
    expect(sql).toMatch(/DATE_FORMAT\(i\.invoiceDate/);
    expect(sql).toMatch(/UNIX_TIMESTAMP\(ea\.createdAt\)/);
  });

  it("with no candidates, issues no writes and reports nothing", async () => {
    const reconcile = await subject();
    execute.mockResolvedValueOnce(asRows([]));
    const res = await reconcile();
    expect(res).toEqual({ reconciled: 0, superseded: 0, skippedAlreadyClaimed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("three rows, one invoice", () => {
  it("issues ONE arrived-update and TWO same-visit closures", async () => {
    const reconcile = await subject();
    execute
      .mockResolvedValueOnce(asRows(THREE_ROWS_ONE_INVOICE))
      .mockResolvedValueOnce(affected(1)) // arrival 3 -> arrived
      .mockResolvedValueOnce(affected(1)) // arrival 1 -> cancelled
      .mockResolvedValueOnce(affected(1)); // arrival 2 -> cancelled

    const res = await reconcile();

    expect(res).toEqual({ reconciled: 1, superseded: 2, skippedAlreadyClaimed: 0 });
    const writes = execute.mock.calls.slice(1).map(sqlTextOf);
    expect(writes.filter((s) => /status = 'arrived'/.test(s))).toHaveLength(1);
    expect(writes.filter((s) => /status = 'cancelled'/.test(s))).toHaveLength(2);
  });

  it("the arrived-update is guarded so a row claimed meanwhile is not overwritten", async () => {
    const reconcile = await subject();
    execute
      .mockResolvedValueOnce(asRows(THREE_ROWS_ONE_INVOICE))
      .mockResolvedValue(affected(1));
    await reconcile();
    const arrived = execute.mock.calls.slice(1).map(sqlTextOf).find((s) => /status = 'arrived'/.test(s))!;
    expect(arrived).toMatch(/status = 'expected'/);
    expect(arrived).toMatch(/reconciledInvoiceId IS NULL/);
  });

  it("the same-visit closure keeps the note inside the column, and names the winner", async () => {
    // TiDB rejects an over-width write outright and LOSES the row, so the
    // concatenated note must be truncated to the column width in SQL.
    const reconcile = await subject();
    execute
      .mockResolvedValueOnce(asRows(THREE_ROWS_ONE_INVOICE))
      .mockResolvedValue(affected(1));
    await reconcile();
    const closures = execute.mock.calls.slice(1).map(sqlTextOf).filter((s) => /status = 'cancelled'/.test(s));
    for (const c of closures) {
      expect(c).toMatch(/LEFT\(CONCAT_WS\(' \| ', note,/);
      expect(c).toMatch(/, 500\)/);
      expect(c).toMatch(/status = 'expected'/);
    }
    // The bound parameter carries the winner and invoice, not a bare label.
    // Drizzle nests params inside its chunk tree, so serialise the whole
    // statement rather than walking one level.
    const serialised = JSON.stringify(execute.mock.calls.slice(1).map((call) => call[0]));
    expect(serialised).toMatch(/superseded: same visit as arrival #3 \(invoice 500\)/);
  });
});

describe("the unique index rejects a second claim", () => {
  it("ER_DUP_ENTRY on a claim is counted as already claimed, and the run continues", async () => {
    const reconcile = await subject();
    const dup = Object.assign(new Error("Duplicate entry '500' for key 'expected_arrivals.uq_ea_reconciled_invoice'"), {
      code: "ER_DUP_ENTRY",
    });
    execute
      .mockResolvedValueOnce(asRows(THREE_ROWS_ONE_INVOICE))
      .mockRejectedValueOnce(dup)        // our claim loses the race
      .mockResolvedValueOnce(affected(1)) // closures still run
      .mockResolvedValueOnce(affected(1));

    const res = await reconcile();
    expect(res).toEqual({ reconciled: 0, superseded: 2, skippedAlreadyClaimed: 1 });
  });

  it("a non-duplicate failure keeps the cron best-effort contract: nothing, not a throw", async () => {
    const reconcile = await subject();
    execute
      .mockResolvedValueOnce(asRows(THREE_ROWS_ONE_INVOICE))
      .mockRejectedValueOnce(Object.assign(new Error("ER_LOCK_DEADLOCK"), { code: "ER_LOCK_DEADLOCK" }));
    const res = await reconcile();
    expect(res).toEqual({ reconciled: 0, superseded: 0, skippedAlreadyClaimed: 0 });
  });
});

describe("arrivalSignalsForQueue — the two arrival facts the kernel cannot see on a call", () => {
  // `invoicedPhones` was accepted by buildRecoveryQueue and never supplied, so
  // kernel rule 5 ("already invoiced") never fired. And "open" meant "expected
  // TODAY", which routed "I'll come by tomorrow" into recovery a day early.
  async function signals() {
    return (await import("../services/expectedArrivals")).arrivalSignalsForQueue;
  }
  const CUTOFF = new Date("2026-06-24T00:00:00Z");

  it("OPEN means still expected and not past the reconcile window — not merely today", async () => {
    const arrivalSignalsForQueue = await signals();
    execute
      .mockResolvedValueOnce(asRows([{ customerPhone: "2165557777" }, { customerPhone: "(216) 555-1234" }]))
      .mockResolvedValueOnce(asRows([]));
    const r = await arrivalSignalsForQueue(CUTOFF);
    const sql = sqlTextOf(execute.mock.calls[0]);
    expect(sql).toMatch(/status = 'expected'/);
    expect(sql).toMatch(/expectedDate >= DATE_SUB\(CURDATE\(\), INTERVAL 3 DAY\)/);
    expect(sql).not.toMatch(/expectedDate = /);
    expect([...r.expectedArrivalPhones]).toEqual(["2165557777", "2165551234"]);
  });

  it("the invoiced day comes from the RECONCILED invoice, latest per phone, formatted in SQL", async () => {
    const arrivalSignalsForQueue = await signals();
    execute
      .mockResolvedValueOnce(asRows([]))
      .mockResolvedValueOnce(asRows([{ phone: "2165558888", invoicedDay: "2026-09-22" }]));
    const r = await arrivalSignalsForQueue(CUTOFF);
    const sql = sqlTextOf(execute.mock.calls[1]);
    expect(sql).toMatch(/JOIN invoices i ON i\.id = ea\.reconciledInvoiceId/);
    expect(sql).toMatch(/status = 'arrived'/);
    expect(sql).toMatch(/DATE_FORMAT\(MAX\(i\.invoiceDate\), '%Y-%m-%d'\)/);
    expect(sql).toMatch(/GROUP BY ea\.customerPhone/);
    expect(r.invoicedOnOrAfter.get("2165558888")).toBe("2026-09-22");
  });

  it("drops junk rather than handing it to the kernel", async () => {
    const arrivalSignalsForQueue = await signals();
    execute
      .mockResolvedValueOnce(asRows([{ customerPhone: "555" }]))
      .mockResolvedValueOnce(asRows([{ phone: "2165558888", invoicedDay: "not-a-day" }, { phone: "12", invoicedDay: "2026-09-22" }]));
    const r = await arrivalSignalsForQueue(CUTOFF);
    expect(r.expectedArrivalPhones.size).toBe(0);
    expect(r.invoicedOnOrAfter.size).toBe(0);
  });

  it("FAILS OPEN to empty signals when the read breaks — a noisier queue, never a hidden customer", async () => {
    const arrivalSignalsForQueue = await signals();
    execute.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const r = await arrivalSignalsForQueue(CUTOFF);
    expect(r.expectedArrivalPhones.size).toBe(0);
    expect(r.invoicedOnOrAfter.size).toBe(0);
  });

  it("POSITIVE CONTROL: the two facts are keyed and shaped for buildRecoveryQueue's options verbatim", async () => {
    // The router spreads the result straight into the options object; a
    // renamed key would compile (the options are all optional) and silently
    // starve the kernel again — the exact defect this closes.
    const arrivalSignalsForQueue = await signals();
    execute.mockResolvedValueOnce(asRows([])).mockResolvedValueOnce(asRows([]));
    const r = await arrivalSignalsForQueue(CUTOFF);
    expect(Object.keys(r).sort()).toEqual(["expectedArrivalPhones", "invoicedOnOrAfter"]);
  });
});

describe("POSITIVE CONTROL", () => {
  it("two distinct invoices produce two arrived-updates — the one-per-invoice rule is not one-total", async () => {
    const reconcile = await subject();
    execute
      .mockResolvedValueOnce(
        asRows([
          { arrivalId: 10, expectedDate: "2026-09-21", createdTs: 1, invoiceId: 600, invoiceDate: "2026-09-21" },
          { arrivalId: 11, expectedDate: "2026-09-23", createdTs: 2, invoiceId: 601, invoiceDate: "2026-09-23" },
        ]),
      )
      .mockResolvedValue(affected(1));
    const res = await reconcile();
    expect(res.reconciled).toBe(2);
    expect(execute.mock.calls.slice(1).map(sqlTextOf).filter((s) => /status = 'arrived'/.test(s))).toHaveLength(2);
  });
});
