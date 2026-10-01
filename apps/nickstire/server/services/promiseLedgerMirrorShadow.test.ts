/**
 * Q-22 phase 1 · the obligation mirror's rows stay in SHADOW (ADR-0020 §8).
 *
 * Arming `obligation_mirror_enabled` must change nothing an operator sees: the
 * open list (PromisesPanel, the sweep's page), the open count and the kept-rate
 * all leave out every MIRROR_SOURCE_KINDS row. Without this, a week of mirrored
 * owed texts would be escalated into the Decision Inbox by the sweep beside the
 * Telegram that already covers them, and would push the operator's own
 * promises off the due_at-ordered page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: h.getDb }));
vi.mock("./opportunityQueue", () => ({ upsertOpportunity: vi.fn(), transitionOpportunity: vi.fn() }));

import { listOpenPromises, promiseLedgerStats, sweepOverduePromises } from "./promiseLedger";

function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

/** ADR-0020 §4: the three source kinds the obligation mirror writes. */
const MIRROR_SOURCE_KINDS = ["callback_request", "owed_reply", "emergency"];

/** The readers' queries, each checked to exclude exactly the mirror kinds. */
function expectShadowed(q: { text: string; params: unknown[] }) {
  expect(q.text).toContain("source_kind NOT IN (?, ?, ?)");
  expect(q.params).toEqual(expect.arrayContaining(MIRROR_SOURCE_KINDS));
}

describe("mirror rows are invisible to every phase-1 reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getDb.mockResolvedValue({ execute: h.execute });
    h.execute.mockResolvedValue([[]]);
  });

  it("listOpenPromises (the panel, and the sweep's page)", async () => {
    await listOpenPromises(50);
    expectShadowed(flat(h.execute.mock.calls[0][0]));
  });

  it("the sweep's open list and open count", async () => {
    h.execute.mockResolvedValueOnce([[{
      id: "p1", promise_type: "callback", promised_action: "call", due_at: "2026-09-29T10:00:00Z", status: "open",
      created_by: "x", created_at: "2026-09-29T09:00:00Z", escalated_at: "2026-09-29T11:00:00Z",
    }]]);
    await sweepOverduePromises();
    const texts = h.execute.mock.calls.map((c) => flat(c[0]));
    const reads = texts.filter((q) => q.text.startsWith("SELECT"));
    expect(reads.length).toBe(2);
    for (const q of reads) expectShadowed(q);
  });

  it("the kept-rate", async () => {
    await promiseLedgerStats(30);
    expectShadowed(flat(h.execute.mock.calls[0][0]));
  });
});
