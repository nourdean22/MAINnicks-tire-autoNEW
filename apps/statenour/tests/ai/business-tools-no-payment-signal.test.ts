/**
 * Shop truth (Nour, 2026-10-21): an invoice is a CLOSED job, an estimate that
 * never became an invoice means the customer WALKED, and payment is collected
 * on a separate register. Invoice payment status is therefore not a signal, and
 * Nick must not be told to chase "unpaid invoices" or `paymentStatus='pending'`.
 *
 * Pins the model-facing text of the two tools that used to say so:
 *  - getAttentionAlerts description
 *  - getEstimateLeaks returned `analysis`
 *
 * CONTROL: the assertions are about absence, so the positive halves prove the
 * scan reads real text (the stale-lead / walked-estimate wording must remain).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", () => ({ queryNick }));
vi.mock("@/lib/integrations/google-reviews", () => ({
  getReviewStats: vi.fn(async () => ({ average: 4.8, total: 120, unresponded: 2 })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { businessTools } from "@/lib/ai/tools/business";

type Exec = { description?: string; execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const BANNED = /unpaid|paymentStatus/i;

beforeEach(() => {
  queryNick.mockReset();
  queryNick.mockResolvedValue({ data: [], query: "x", timestamp: "t" });
});

describe("business tools never frame invoice payment status as a signal", () => {
  it("getAttentionAlerts description does not mention unpaid invoices", () => {
    const description = (businessTools.getAttentionAlerts as unknown as Exec).description ?? "";
    expect(description, "scan must read real text").toMatch(/stale leads/i);
    expect(description).not.toMatch(BANNED);
  });

  it("getEstimateLeaks analysis does not tell Nick to chase pending-payment invoices", async () => {
    const out = (await (businessTools.getEstimateLeaks as unknown as Exec).execute({ daysBack: 7 }, {})) as {
      analysis: string;
    };
    expect(out.analysis, "scan must read real text").toMatch(/walked/i);
    expect(out.analysis).not.toMatch(BANNED);
    expect(out.analysis).toMatch(/separate register/i);
  });

  it("no business tool description mentions unpaid invoices", () => {
    const hits = Object.entries(businessTools)
      .filter(([, t]) => BANNED.test((t as unknown as Exec).description ?? ""))
      .map(([name]) => name);
    expect(hits).toEqual([]);
  });
});
