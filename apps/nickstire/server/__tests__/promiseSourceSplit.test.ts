/**
 * The kept-rate must never include promises that cannot be kept automatically.
 *
 * THIS GUARDS A SELF-INFLICTED RISK. Wiring voice calls into the Promise Ledger
 * means promises are now created AUTOMATICALLY and at volume. But `kept` is only
 * ever set by an operator pressing Keep — `keepPromise` has exactly one caller —
 * and the real callback happens on the counter phone, which this system cannot
 * observe.
 *
 * So if voice promises counted toward the kept-rate, they would fill the
 * denominator on their own, never produce a numerator, and sweep to `missed`
 * after 48h. The morning brief would then report "N MISSED" to Nick as though he
 * had broken N promises, when the truth is that keeping was never measurable.
 *
 * Unmeasured is not failed. These tests assert the SQL split that keeps those
 * two facts apart, by inspecting the statements the functions actually issue.
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

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue(asRows([{}]));
});
afterEach(() => vi.restoreAllMocks());

describe("promiseLedgerStats — the kept-rate", () => {
  it("EXCLUDES voice-sourced promises", async () => {
    const { promiseLedgerStats } = await import("../services/promiseLedger");
    await promiseLedgerStats(30);
    const sql = sqlTextOf(execute.mock.calls[0]);
    expect(sql).toContain("source_kind <> 'voice'");
  });

  it("still scores kept on-time vs late — the rate itself is intact", async () => {
    // Guards against "fixing" the defamation risk by gutting the metric.
    const { promiseLedgerStats } = await import("../services/promiseLedger");
    await promiseLedgerStats(30);
    const sql = sqlTextOf(execute.mock.calls[0]);
    expect(sql).toContain("kept_at <= due_at");
    expect(sql).toContain("kept_at > due_at");
  });
});
