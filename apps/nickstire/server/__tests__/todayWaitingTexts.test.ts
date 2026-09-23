/**
 * Today's "waiting on a text reply" items read the ROS-058 obligation
 * (sms_response_jobs, status human_pending), not a second derivation from the
 * message log. Post-merge audit item I (2026-09-23): #2582 had built that
 * second derivation, so "No reply needed" left the Today item in place, an
 * automated cron text cleared a thread a human still owed, the operator's own
 * texts showed up as "Texting customer", and Today and the Outreach badge
 * disagreed on the count.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATOR_MOBILE_LAST10 } from "../services/nonCustomerFilter";
import {
  summarizeWaitingConversations,
  waitingConversations,
  type HumanPendingRow,
} from "../services/smsResponseJobs";

let nextJob = 1;
/** One inbound text whose ROS-058 obligation is in `status`. */
const job = (
  conversationId: number,
  waitingMinutes: number,
  opts: Partial<Pick<HumanPendingRow, "phone" | "customerName" | "body">> & { status?: string } = {},
): HumanPendingRow & { status: string } => ({
  jobId: nextJob++,
  conversationId,
  phone: opts.phone ?? `+1216404${String(1000 + conversationId).slice(-4)}`,
  customerName: opts.customerName ?? `Customer ${conversationId}`,
  body: opts.body ?? "Do you have 225/65R17 in stock?",
  waitingMinutes,
  overdue: waitingMinutes >= 30,
  status: opts.status ?? "human_pending",
});

/** What the reader's SQL returns: only open obligations. */
const open = (rows: Array<HumanPendingRow & { status: string }>) => rows.filter((r) => r.status === "human_pending");

describe("Today's waiting texts follow the ROS-058 obligation", () => {
  it("POSITIVE CONTROL: an open obligation is one Today item, with the customer's words", () => {
    const items = waitingConversations(open([job(1, 45)]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ conversationId: 1, customerName: "Customer 1", preview: "Do you have 225/65R17 in stock?", overdue: true });
  });

  it("a thread marked 'No reply needed' leaves Today (its obligation is no_reply_required)", () => {
    const items = waitingConversations(open([job(2, 300, { status: "no_reply_required" }), job(3, 300)]));
    expect(items.map((i) => i.conversationId)).toEqual([3]);
  });

  it("an automated text after the customer's does NOT clear it: only a human reply closes the obligation", () => {
    // The drip/recovery cron texted this customer after they asked; nobody answered
    // them. The obligation stays human_pending, so the item stays.
    expect(waitingConversations(open([job(4, 120)]))).toHaveLength(1);
    expect(waitingConversations(open([job(4, 120, { status: "human_replied" })]))).toEqual([]);
  });

  it("an internal line (the operator's own mobile, the shop's line) never appears", () => {
    const items = waitingConversations(open([
      job(5, 90, { phone: `+1${OPERATOR_MOBILE_LAST10}`, customerName: null }),
      job(6, 90, { phone: "(216) 862-0005" }),
      job(7, 90),
    ]));
    expect(items.map((i) => i.conversationId)).toEqual([7]);
  });

  it("two texts in one thread are ONE waiting customer, waiting since the first, showing the latest", () => {
    const items = waitingConversations(open([
      job(8, 95, { body: "Do you have 225/65R17?" }),
      job(8, 20, { body: "Hello??" }),
    ]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ waitingMinutes: 95, preview: "Hello??", texts: 2, overdue: true });
  });

  it("oldest wait first; Urgent is exactly the 30-min SLA the badge and alerts use", () => {
    const items = waitingConversations(open([job(9, 10), job(10, 600), job(11, 45)]));
    expect(items.map((i) => [i.conversationId, i.overdue])).toEqual([[10, true], [11, true], [9, false]]);
  });

  it("Today's count equals the ROS-058 summary for the same rows", () => {
    const rows = open([
      job(12, 95), job(12, 20), job(13, 5), job(14, 400, { status: "no_reply_required" }),
      job(15, 60, { phone: `+1${OPERATOR_MOBILE_LAST10}` }), job(16, 31),
    ]);
    const today = waitingConversations(rows);
    const summary = summarizeWaitingConversations(rows);
    expect(today).toHaveLength(3);
    expect(summary).toEqual({
      humanPending: today.length,
      overdue: today.filter((t) => t.overdue).length,
      oldestWaitingMinutes: 95,
    });
  });

  it("an empty queue is a real zero with a null oldest", () => {
    expect(summarizeWaitingConversations([])).toEqual({ humanPending: 0, overdue: 0, oldestWaitingMinutes: null });
  });
});

describe("wiring (source pins)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");

  it("the Today bundle reads the ROS-058 reader, and #2582's parallel derivation is gone", () => {
    const bundle = read("server/services/adminBundle.ts");
    expect(bundle).toMatch(/listWaitingConversations\(\)/);
    expect(bundle).not.toMatch(/getOwedTexts/);
    expect(() => read("server/services/owedTexts.ts")).toThrow();
    expect(() => read("server/lib/owedTextsRule.ts")).toThrow();
  });

  it("Today offers the existing 'No reply needed' mutation on a text item", () => {
    const overview = read("client/src/pages/admin/OverviewSection.tsx");
    expect(overview).toMatch(/smsConversations\.markNoReplyNeeded\.useMutation/);
    expect(overview).toMatch(/urgency: text\.overdue \? 4 : 3/);
  });
});
