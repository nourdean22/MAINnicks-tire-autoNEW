/**
 * Task 6b follow-ups on app/api/telegram/webhook/route.ts (2026-10-10):
 *   1. `oppsms` Approve/Decline is a compare-and-swap claim, like approve and
 *      intell_recall (SN-04); its edit messages escape body + label (SN-07).
 *   2. No Telegram reply forwards a raw error message (provider/DB text can
 *      embed secrets); /draft escapes the model's text.
 *   3. The `oc` rating branch settles its tracking receipt with a REAL
 *      ActionStatus value -- "DONE" is not one, and the write was swallowed.
 *   4. One escapeHtml (lib/utils/escape-html.ts), not a private copy.
 *   5. Malformed-payload diagnostics go to the repo logger with the phone
 *      masked to its last 4 digits, never console.error with the full payload.
 *
 * Races are driven by gates, not Promise.all (see approve-double-tap.test.ts
 * for why). fetch throws; nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = { id: string; action: string; status: string; context: string | null; verificationPayload: unknown };

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
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
    if (typeof data.status === "string") statusHistory.set(id, [...(statusHistory.get(id) ?? []), data.status]);
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
      const snapshot = r ? { ...r } : null;
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
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? 0 : null;
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        model === "actionReceipt"
          ? actionReceipt
          : new Proxy({}, { get: (_m, method: string) => inert(method) }),
    },
  );
  const queryNick = vi.fn(async (..._a: unknown[]) => {
    if (gates.send) {
      const g = gates.send;
      gates.send = null;
      await g;
    }
    return { data: { ok: true, sent: true } };
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    rows,
    statusHistory,
    gates,
    actionReceipt,
    prisma,
    queryNick,
    log,
    recordOutcomeResult: vi.fn(async (..._a: unknown[]): Promise<"recorded" | "already" | "failed"> => "recorded"),
    ingestJournal: vi.fn(async (..._a: unknown[]) => ({})),
    createTask: vi.fn(async (..._a: unknown[]) => null as unknown),
    today: vi.fn(() => "2026-10-10"),
    ghostwrite: vi.fn(async (..._a: unknown[]) => ({ text: "", needsClarification: false, score: null, regenApplied: false })),
    createDraft: vi.fn(async (..._a: unknown[]) => ({ key: "draft_1" })),
    telegram: {
      answerCallbackQuery: vi.fn(async (..._a: unknown[]) => true),
      editTelegramMessage: vi.fn(async (..._a: unknown[]) => true),
      sendTelegram: vi.fn(async (..._a: unknown[]) => true),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => h.log, info: h.log.info, warn: h.log.warn, error: h.log.error, debug: h.log.debug },
}));
vi.mock("@/lib/services/telegram", () => h.telegram);
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick: h.queryNick }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcomeResult: h.recordOutcomeResult }));
vi.mock("@/lib/brain/journal-ingest", () => ({ ingestJournal: h.ingestJournal }));
vi.mock("@/lib/services/tasks", () => ({ createTask: h.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: async () => "m_inbox" }));
vi.mock("@/lib/utils/datetime", () => ({ today: h.today }));
vi.mock("@/lib/ai/ghostwriter", () => ({ ghostwrite: h.ghostwrite }));
vi.mock("@/lib/content/drafts", () => ({ createDraft: h.createDraft }));
vi.mock("@/lib/ai/agent-actions/shop-actions", () => ({
  callNickstire: vi.fn(async () => ({ result: {} })),
  isBridgeError: (res: unknown) => !res || (typeof res === "object" && "error" in (res as object)),
}));

import { POST } from "@/app/api/telegram/webhook/route";

const WEBHOOK = readFileSync(join(__dirname, "../../app/api/telegram/webhook/route.ts"), "utf8");
const SECRET_TEXT = "sk-ant-SECRET-999";
const PHONE = "+15550001111";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.statusHistory.clear();
  h.gates.send = null;
  h.gates.read = null;
});

let cq = 0;
function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify(body),
    }),
  );
}
const tap = (data: string) =>
  post({ callback_query: { id: `cq_${++cq}`, data, from: { id: 4242 }, message: { message_id: 7, chat: { id: 4242 } } } });
const say = (text: string) => post({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } });

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

function seedOpp(id = "rcpt_opp", body = "Your quote is ready", customerLabel = "Sam (stale lead)") {
  h.rows.set(id, {
    id,
    action: "shop.sendOpportunitySms",
    status: "PENDING",
    context: `Opportunity SMS approval for ${customerLabel}`,
    verificationPayload: {
      kind: "opportunity_sms",
      opportunityId: "11111111-2222-4333-8444-555555555555",
      body,
      idempotencyKey: "opp-test-key",
      customerLabel,
    },
  });
}

const sentTexts = () => h.telegram.sendTelegram.mock.calls.map((c) => String(c[0])).join("\n");
const editTexts = () => h.telegram.editTelegramMessage.mock.calls.map((c) => String(c[1])).join("\n");

describe("oppsms is a claim, not a check", () => {
  it("a second Approve while the first send is in flight calls nickstire once", async () => {
    seedOpp();
    const g = gate();
    h.gates.send = g.promise;
    const first = tap("oppsms:approve:rcpt_opp");
    await vi.waitFor(() => expect(h.queryNick).toHaveBeenCalledTimes(1));
    await tap("oppsms:approve:rcpt_opp");
    g.release();
    await first;
    expect(h.queryNick).toHaveBeenCalledTimes(1);
    expect(h.statusHistory.get("rcpt_opp")).toEqual(["SUCCESS"]);
  });

  it("a stale Decline that resumes while Approve is mid-send is refused", async () => {
    seedOpp();
    const read = gate();
    h.gates.read = read.promise;
    const first = tap("oppsms:deny:rcpt_opp");
    await vi.waitFor(() => expect(h.actionReceipt.findUnique).toHaveBeenCalledTimes(1));
    const send = gate();
    h.gates.send = send.promise;
    const second = tap("oppsms:approve:rcpt_opp");
    await vi.waitFor(() => expect(h.queryNick).toHaveBeenCalledTimes(1));
    read.release();
    await first;
    send.release();
    await second;
    expect(h.statusHistory.get("rcpt_opp")).toEqual(["SUCCESS"]);
  });

  it("positive control: Decline alone records FAILED and calls nothing", async () => {
    seedOpp();
    await tap("oppsms:deny:rcpt_opp");
    expect(h.queryNick).not.toHaveBeenCalled();
    expect(h.statusHistory.get("rcpt_opp")).toEqual(["FAILED"]);
  });

  it("approve and decline edit messages escape the body and label", async () => {
    seedOpp("rcpt_opp", "Hi <tg-spoiler>pay</tg-spoiler> & go", "<i>Sam</i>");
    await tap("oppsms:approve:rcpt_opp");
    seedOpp("rcpt_opp2", "Hi <tg-spoiler>pay</tg-spoiler> & go", "<i>Sam</i>");
    await tap("oppsms:deny:rcpt_opp2");
    const edits = editTexts();
    expect(edits).toContain("Hi &lt;tg-spoiler&gt;pay&lt;/tg-spoiler&gt; &amp; go");
    expect(edits).toContain("&lt;i&gt;Sam&lt;/i&gt;");
    expect(edits).not.toContain("<tg-spoiler>");
  });
});

describe("no Telegram reply forwards a raw error message", () => {
  it("/dump failure", async () => {
    h.ingestJournal.mockRejectedValueOnce(new Error(`db said ${SECRET_TEXT}`));
    await say("/dump something happened today");
    expect(sentTexts()).toContain("Dump failed");
    expect(sentTexts()).not.toContain(SECRET_TEXT);
  });

  it("/task failure", async () => {
    h.createTask.mockRejectedValueOnce(new Error(`db said ${SECRET_TEXT}`));
    await say("/task call the supplier");
    expect(sentTexts()).toContain("Task failed");
    expect(sentTexts()).not.toContain(SECRET_TEXT);
  });

  it("the outer 'Command failed' catch", async () => {
    h.today.mockImplementationOnce(() => {
      throw new Error(`boom ${SECRET_TEXT}`);
    });
    await say("/status");
    expect(sentTexts()).toContain("Command failed");
    expect(sentTexts()).not.toContain(SECRET_TEXT);
  });

  it("/draft failure", async () => {
    h.ghostwrite.mockRejectedValueOnce(new Error(`provider said ${SECRET_TEXT}`));
    await say("/draft sms follow up with the fleet lead about tires");
    expect(sentTexts()).toContain("Draft failed");
    expect(sentTexts()).not.toContain(SECRET_TEXT);
  });

  it("source guard: every err.message in the webhook goes to a store, a trace, a log or a tool result -- never a reply", () => {
    const allowed = /context:|errorMessage:|return \{ ok: false, error:|logError\(|log\.(warn|error|info|debug)\(|message: err instanceof Error \? err\.message\.slice/;
    const offenders = WEBHOOK.split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\berr(?: as Error\))?\.message|err instanceof Error \? err\.message/.test(line))
      .filter(({ line }) => !allowed.test(line));
    expect(offenders).toEqual([]);
  });
});

describe("/draft escapes the model's text", () => {
  it("a drafted body with markup is shown escaped", async () => {
    h.ghostwrite.mockResolvedValueOnce({ text: "Deal <tg-spoiler>today</tg-spoiler> & save", needsClarification: false, score: null, regenApplied: false });
    await say("/draft sms follow up with the fleet lead about tires");
    expect(sentTexts()).toContain("Deal &lt;tg-spoiler&gt;today&lt;/tg-spoiler&gt; &amp; save");
    expect(sentTexts()).toContain("<b>Draft</b>");
  });

  it("a clarifying question is shown escaped", async () => {
    h.ghostwrite.mockResolvedValueOnce({ text: "Which <b>lead</b>?", needsClarification: true, score: null, regenApplied: false });
    await say("/draft sms follow up with the fleet lead about tires");
    expect(sentTexts()).toContain("Which &lt;b&gt;lead&lt;/b&gt;?");
  });
});

describe("oc rating settles its tracking receipt with a real ActionStatus", () => {
  it("writes SUCCESS, never DONE", async () => {
    await tap("oc:u:ledger_1");
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ id: "ledger_1", useful: true }));
    const statuses = h.actionReceipt.update.mock.calls.map((c) => (c[0] as { data: { status?: string } }).data.status);
    expect(statuses).toEqual(["SUCCESS"]);
  });
});

describe("oc rating answers from the tri-state result", () => {
  const answer = () => h.telegram.answerCallbackQuery.mock.calls.at(-1)?.[1];
  it("recorded -> Noted.", async () => {
    h.recordOutcomeResult.mockResolvedValueOnce("recorded");
    await tap("oc:n:ledger_2");
    expect(answer()).toBe("Noted.");
  });
  it("already -> Already rated.", async () => {
    h.recordOutcomeResult.mockResolvedValueOnce("already");
    await tap("oc:u:ledger_3");
    expect(answer()).toBe("Already rated.");
  });
  it("failed -> Could not record - try again. (not Already rated.)", async () => {
    h.recordOutcomeResult.mockResolvedValueOnce("failed");
    await tap("oc:u:ledger_4");
    expect(answer()).toBe("Could not record - try again.");
  });
});

describe("one escapeHtml", () => {
  it("the webhook imports lib/utils/escape-html and keeps no private copy", () => {
    expect(WEBHOOK).toMatch(/import \{ escapeHtml \} from "@\/lib\/utils\/escape-html";/);
    expect(WEBHOOK).not.toMatch(/^function escapeHtml\(/m);
  });
});

describe("malformed-payload diagnostics", () => {
  it("approve: logs through the repo logger with the phone masked to its last 4", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rows.set("rcpt_bad", { id: "rcpt_bad", action: "shop.sendSms", status: "PENDING", context: null, verificationPayload: { phone: PHONE } });
    await tap("approve:rcpt_bad");
    const logged = JSON.stringify(h.log.error.mock.calls);
    expect(h.log.error).toHaveBeenCalled();
    expect(logged).toContain("1111");
    expect(logged).not.toContain("5550001111");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("5550001111");
    spy.mockRestore();
  });

  it("intell_recall: same", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rows.set("rcpt_bad2", { id: "rcpt_bad2", action: "intell_recall", status: "PENDING", context: null, verificationPayload: { phone: PHONE } });
    await tap("intell_recall:approve:rcpt_bad2");
    const logged = JSON.stringify(h.log.error.mock.calls);
    expect(h.log.error).toHaveBeenCalled();
    expect(logged).not.toContain("5550001111");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("5550001111");
    spy.mockRestore();
  });

  it("oppsms: logs through the repo logger, not console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rows.set("rcpt_bad3", { id: "rcpt_bad3", action: "shop.sendOpportunitySms", status: "PENDING", context: null, verificationPayload: { kind: "nope" } });
    await tap("oppsms:approve:rcpt_bad3");
    expect(h.log.error).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
