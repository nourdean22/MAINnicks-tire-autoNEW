/**
 * The approval prompt shows the operator exactly the text that will be sent
 * (07-SN-07).
 *
 * THE DEFECT: stageCustomerAlert and sendOpportunitySms built a parse_mode
 * "HTML" Telegram prompt by interpolating model-supplied values raw
 * (lib/ai/tools/social.ts). A message containing `<tg-spoiler>` rendered as a
 * hidden spoiler: the operator approved a prompt that did not show what the
 * customer would receive. A stray `<` or `&` made Telegram answer 400 and the
 * prompt never arrived at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendTelegramWithButtons: vi.fn(async (..._a: unknown[]) => ({ ok: true, messageId: 1 })),
  receiptCreate: vi.fn(async (..._a: unknown[]) => ({ id: "rcpt_1" })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { actionReceipt: { create: h.receiptCreate } } }));
vi.mock("@/lib/services/telegram", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/telegram")>()),
  sendTelegramWithButtons: h.sendTelegramWithButtons,
}));
// Run the staged body directly; the dedupe marker store is not under test.
vi.mock("@/lib/ai/tools/tool-idempotency", () => ({
  idempotencyKey: (tool: string, content: string) => `${tool}:${content}`,
  withToolIdempotency: async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
}));

import { socialTools } from "@/lib/ai/tools/social";

const toolOpts = { toolCallId: "t1", messages: [] } as never;

function promptText(): string {
  return String(h.sendTelegramWithButtons.mock.calls[0]?.[0] ?? "");
}

beforeEach(() => vi.clearAllMocks());

describe("stageCustomerAlert prompt", () => {
  it("escapes the message, name and phone; keeps the authored markup", async () => {
    await socialTools.stageCustomerAlert.execute!(
      {
        phone: "+1555<0001>",
        message: "Hi <tg-spoiler>pay $500 now</tg-spoiler> & reply",
        customerName: "Sam & <b>Co</b>",
      },
      toolOpts,
    );
    const text = promptText();
    expect(text).toContain("&lt;tg-spoiler&gt;pay $500 now&lt;/tg-spoiler&gt; &amp; reply");
    expect(text).not.toContain("<tg-spoiler>");
    expect(text).toContain("Sam &amp; &lt;b&gt;Co&lt;/b&gt;");
    expect(text).toContain("+1555&lt;0001&gt;");
    // Positive control: the prompt's own formatting still renders.
    expect(text).toContain("<b>Staged SMS Outreach</b>");
    expect(text).toContain("<b>Message:</b>");
  });

  it("the stored receipt keeps the raw text the customer will receive", async () => {
    await socialTools.stageCustomerAlert.execute!(
      { phone: "+15550001111", message: "a <b>b</b> & c" },
      toolOpts,
    );
    const data = (h.receiptCreate.mock.calls[0]?.[0] as { data: { verificationPayload: { message: string } } }).data;
    expect(data.verificationPayload.message).toBe("a <b>b</b> & c");
  });
});

describe("sendOpportunitySms prompt", () => {
  it("escapes the body and the customer label; keeps the authored markup", async () => {
    await socialTools.sendOpportunitySms.execute!(
      {
        opportunityId: "11111111-2222-4333-8444-555555555555",
        body: "Your quote <tg-spoiler>expires</tg-spoiler> & more",
        customerLabel: "<i>Sam</i> (stale lead)",
      },
      toolOpts,
    );
    const text = promptText();
    expect(text).toContain("Your quote &lt;tg-spoiler&gt;expires&lt;/tg-spoiler&gt; &amp; more");
    expect(text).not.toContain("<tg-spoiler>");
    expect(text).toContain("&lt;i&gt;Sam&lt;/i&gt; (stale lead)");
    expect(text).toContain("<b>Opportunity SMS");
  });
});
