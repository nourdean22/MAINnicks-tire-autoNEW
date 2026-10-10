/**
 * Telegram Approve is a claim, not a check (07-SN-04).
 *
 * THE DEFECT: the `approve` and `intell_recall` callback branches read the
 * ActionReceipt, checked `status === "PENDING"`, called
 * `callNickstire("smsBot.send")`, and only THEN wrote the verdict. Two taps
 * (a double tap, or Telegram redelivering the update) both read PENDING and
 * both sent the customer SMS. Decline racing Approve was worse: Decline wrote
 * FAILED "Rejected by operator" while the Approve tap's send was in flight,
 * then Approve overwrote it with SUCCESS.
 *
 * The store below is an in-memory ActionReceipt table whose updateMany
 * evaluates its WHERE against the CURRENT row, so a claim that does not pin
 * the field it changes lets the second tap through and the count assertion
 * goes red. Nothing here reaches nickstire: callNickstire is mocked.
 *
 * The races are driven by gates, not Promise.all: two CONCURRENT first
 * `await import("@/lib/prisma")` calls from inside the route resolve the mock
 * for one and the REAL lib/prisma for the other (probed 2026-10-10 on this
 * vitest -- the second tap's create() reached a real Neon client). A gate
 * parks the first tap at the exact point under test while the second tap runs
 * start to finish, which is also the real-world shape: a second tap lands
 * while the first one's bridge call is in flight.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/telegram/webhook/route";

const SECRET = "test-webhook-secret";
const OWNER = 4242;

type Row = {
  id: string;
  action: string;
  status: string;
  context: string | null;
  verificationPayload: unknown;
};

const h = vi.hoisted(() => {
  // The route reads TELEGRAM_WEBHOOK_SECRET at module load: stub before import.
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  // Second fence: if a real bridge client ever loads, its fetch fails here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in this test");
    }),
  );
  const rows = new Map<string, Row>();
  const statusHistory = new Map<string, string[]>();
  const gates: { send: Promise<void> | null; read: Promise<void> | null } = { send: null, read: null };
  let seq = 0;
  const record = (id: string, data: Record<string, unknown>) => {
    if (typeof data.status === "string") {
      statusHistory.set(id, [...(statusHistory.get(id) ?? []), data.status]);
    }
  };
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  const actionReceipt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `trk_${++seq}`, context: null, verificationPayload: null, ...data } as Row;
      rows.set(row.id, row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      const snapshot = r ? { ...r } : null; // read NOW, deliver later
      if (gates.read && !where.id.startsWith("trk_")) {
        const g = gates.read;
        gates.read = null;
        await g;
      }
      return snapshot;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("P2025 record not found");
      record(where.id, data);
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.get(where.id as string);
      if (!r || !matches(r, where)) return { count: 0 };
      record(r.id, data);
      Object.assign(r, data);
      return { count: 1 };
    }),
  };
  const callNickstire = vi.fn(async (..._args: unknown[]) => {
    if (gates.send) {
      const g = gates.send;
      gates.send = null;
      await g;
    }
    return { result: { data: { json: { ok: true } } } };
  });
  const telegram = {
    answerCallbackQuery: vi.fn(async (..._a: unknown[]) => true),
    editTelegramMessage: vi.fn(async (..._a: unknown[]) => true),
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
  };
  return { rows, statusHistory, gates, actionReceipt, callNickstire, telegram };
});

vi.mock("@/lib/prisma", () => ({ prisma: { actionReceipt: h.actionReceipt } }));
vi.mock("@/lib/ai/agent-actions/shop-actions", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/agent-actions/shop-actions")>()),
  callNickstire: h.callNickstire,
}));
vi.mock("@/lib/services/telegram", () => h.telegram);
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));

afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.statusHistory.clear();
  h.gates.send = null;
  h.gates.read = null;
});

let cq = 0;
function tap(data: string): NextRequest {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify({
      callback_query: {
        id: `cq_${++cq}`,
        data,
        from: { id: OWNER },
        message: { message_id: 7, chat: { id: OWNER } },
      },
    }),
  });
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

/** Park the first tap inside its bridge call, run `second` to completion, then let the first finish. */
async function secondTapDuringSend(first: string, second: string): Promise<void> {
  const g = gate();
  h.gates.send = g.promise;
  const firstDone = POST(tap(first));
  await vi.waitFor(() => expect(h.callNickstire).toHaveBeenCalledTimes(1));
  await POST(tap(second));
  g.release();
  await firstDone;
}

/** Both taps read the SAME pending row; the first tap's stale read is delivered after the second tap finished. */
async function sharedStaleRead(first: string, second: string): Promise<void> {
  const g = gate();
  h.gates.read = g.promise;
  const firstDone = POST(tap(first));
  await vi.waitFor(() => expect(h.actionReceipt.findUnique).toHaveBeenCalledTimes(1));
  await POST(tap(second));
  g.release();
  await firstDone;
}

/**
 * The hardest interleaving: the first tap's read is parked; the second tap
 * claims and is parked INSIDE its send (row still PENDING, now marked); the
 * first tap then decides on its stale read. Status alone cannot stop it --
 * only a swap that pins the field the claim changed.
 */
async function staleReadDuringOthersSend(first: string, second: string): Promise<void> {
  const read = gate();
  h.gates.read = read.promise;
  const firstDone = POST(tap(first));
  await vi.waitFor(() => expect(h.actionReceipt.findUnique).toHaveBeenCalledTimes(1));
  const send = gate();
  h.gates.send = send.promise;
  const secondDone = POST(tap(second));
  await vi.waitFor(() => expect(h.callNickstire).toHaveBeenCalledTimes(1));
  read.release();
  await firstDone;
  send.release();
  await secondDone;
}

function seedStagedSms(id = "rcpt_sms", message = "Your tires are ready for pickup") {
  h.rows.set(id, {
    id,
    action: "shop.sendSms",
    status: "PENDING",
    context: `SMS outreach approval for Sam (+15550001111): "${message}"`,
    verificationPayload: { phone: "+15550001111", message, customerName: "Sam" },
  });
}

function seedRecall(id = "rcpt_recall") {
  h.rows.set(id, {
    id,
    action: "intell_recall",
    status: "PENDING",
    context: null,
    verificationPayload: {
      phone: "+15550002222",
      smsBody: "Recall notice for your vehicle",
      customerName: "Ana",
      vehicle: "2019 Civic",
    },
  });
}

const toasts = () => h.telegram.answerCallbackQuery.mock.calls.map((c) => c[1]);

describe("approve:<receiptId> sends at most once", () => {
  it("a second Approve tap while the first send is in flight sends nothing", async () => {
    seedStagedSms();
    await secondTapDuringSend("approve:rcpt_sms", "approve:rcpt_sms");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
    // The loser is told the truth: the first tap is still sending.
    expect(toasts()).toContain("Already in progress.");
    // ...and the settled row no longer carries the claim mark.
    expect(h.rows.get("rcpt_sms")?.context).toMatch(/^SMS outreach approval for Sam/);
  });

  it("two taps that read the same PENDING row: only one claim wins", async () => {
    seedStagedSms();
    await sharedStaleRead("approve:rcpt_sms", "approve:rcpt_sms");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
  });

  it("a stale Approve that resumes while the other tap is mid-send sends nothing", async () => {
    seedStagedSms();
    await staleReadDuringOthersSend("approve:rcpt_sms", "approve:rcpt_sms");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
  });

  it("a stale Decline that resumes while Approve is mid-send is refused", async () => {
    seedStagedSms();
    await staleReadDuringOthersSend("deny:rcpt_sms", "approve:rcpt_sms");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
  });

  it("Decline while the Approve send is in flight is refused; the receipt records only SUCCESS", async () => {
    seedStagedSms();
    await secondTapDuringSend("approve:rcpt_sms", "deny:rcpt_sms");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
  });

  it("Approve on a stale read after a Decline landed sends nothing", async () => {
    seedStagedSms();
    await sharedStaleRead("approve:rcpt_sms", "deny:rcpt_sms");
    expect(h.callNickstire).not.toHaveBeenCalled();
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["FAILED"]);
  });

  it("the send carries the receipt id as its idempotency key", async () => {
    seedStagedSms();
    await POST(tap("approve:rcpt_sms"));
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    const [procedure, , opts] = h.callNickstire.mock.calls[0];
    expect(procedure).toBe("smsBot.send");
    expect(opts).toEqual({ idempotencyKey: "rcpt_sms" });
  });

  it("the claim is a compare-and-swap that names the receipt and PENDING, before the send", async () => {
    seedStagedSms();
    await POST(tap("approve:rcpt_sms"));
    const claim = h.actionReceipt.updateMany.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
    expect(claim?.where).toMatchObject({ id: "rcpt_sms", status: "PENDING" });
    expect(h.actionReceipt.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.callNickstire.mock.invocationCallOrder[0],
    );
  });

  it("positive control: one tap on a staged SMS sends once and records SUCCESS", async () => {
    seedStagedSms();
    await POST(tap("approve:rcpt_sms"));
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["SUCCESS"]);
    expect(toasts()).toEqual(["SMS Dispatched!"]);
  });

  it("positive control: Decline alone records FAILED and sends nothing", async () => {
    seedStagedSms();
    await POST(tap("deny:rcpt_sms"));
    expect(h.callNickstire).not.toHaveBeenCalled();
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["FAILED"]);
    expect(h.rows.get("rcpt_sms")?.context).toBe("Rejected by operator");
  });

  it("a bridge failure after the claim records FAILED (not a stuck claim)", async () => {
    seedStagedSms();
    h.callNickstire.mockResolvedValueOnce({ error: "403 Forbidden" });
    await POST(tap("approve:rcpt_sms"));
    expect(h.statusHistory.get("rcpt_sms")).toEqual(["FAILED"]);
    expect(toasts()).toEqual(["Dispatch failed."]);
  });

  it("the post-approval edit shows the approved text HTML-escaped", async () => {
    seedStagedSms("rcpt_sms", "Hi <tg-spoiler>pay now</tg-spoiler> & thanks");
    await POST(tap("approve:rcpt_sms"));
    const text = String(h.telegram.editTelegramMessage.mock.calls[0]?.[1] ?? "");
    expect(text).toContain("&lt;tg-spoiler&gt;pay now&lt;/tg-spoiler&gt; &amp; thanks");
    expect(text).not.toContain("<tg-spoiler>");
    expect(text).toContain("<b>To:</b>");
  });
});

describe("intell_recall:approve:<receiptId> sends at most once", () => {
  it("a second Approve tap while the first send is in flight sends nothing", async () => {
    seedRecall();
    await secondTapDuringSend("intell_recall:approve:rcpt_recall", "intell_recall:approve:rcpt_recall");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_recall")).toEqual(["SUCCESS"]);
    expect(h.callNickstire.mock.calls[0][2]).toEqual({ idempotencyKey: "rcpt_recall" });
  });

  it("two taps that read the same PENDING row: only one claim wins", async () => {
    seedRecall();
    await sharedStaleRead("intell_recall:approve:rcpt_recall", "intell_recall:approve:rcpt_recall");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
  });

  it("a stale Approve that resumes while the other tap is mid-send sends nothing", async () => {
    seedRecall();
    await staleReadDuringOthersSend("intell_recall:approve:rcpt_recall", "intell_recall:approve:rcpt_recall");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_recall")).toEqual(["SUCCESS"]);
  });

  it("Reject while the Approve send is in flight is refused; the receipt records only SUCCESS", async () => {
    seedRecall();
    await secondTapDuringSend("intell_recall:approve:rcpt_recall", "intell_recall:reject:rcpt_recall");
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_recall")).toEqual(["SUCCESS"]);
  });

  it("positive control: one tap sends once and records SUCCESS", async () => {
    seedRecall();
    await POST(tap("intell_recall:approve:rcpt_recall"));
    expect(h.callNickstire).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_recall")).toEqual(["SUCCESS"]);
  });
});
