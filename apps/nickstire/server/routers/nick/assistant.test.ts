/**
 * Admin assistant (docs/ADMIN-ASSISTANT.md), tested only through its consumer, handleAssistantAsk
 * (what nickActions.ask calls). The router, the model and the database are faked at their module
 * boundary, so every assertion is about what the operator would get back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvokeParams, InvokeResult, ToolCall } from "../../_core/llm";

const state = vi.hoisted(() => ({ caller: null as unknown, invoke: null as unknown, db: {} as unknown }));
vi.mock("../../routers", () => ({ appRouter: { createCaller: () => state.caller } }));
vi.mock("../../_core/llm", () => ({ invokeLLM: (p: unknown) => (state.invoke as (p: unknown) => unknown)(p) }));
vi.mock("../../db", () => ({ getDb: async () => state.db }));

import { handleAssistantAsk } from "./assistant";

const customer = { id: 42, firstName: "Pat", lastName: "Doe", phone: "2165550142", email: "p@example.com", address: "1 Main", smsOptOut: 0, totalSpent: 123456, notes: "likes Michelin" };

/** A fake caller: reads only. The two customer mutations exist so a test can prove they are never called. */
function fakeCaller(overrides: Record<string, unknown> = {}) {
  const quickSms = vi.fn();
  const updateNotes = vi.fn();
  const caller = {
    customers: {
      list: vi.fn(async () => ({ total: 1, customers: [customer], page: 1, pageSize: 10 })),
      getById: vi.fn(async ({ id }: { id: number }) => (id === 42 ? customer : null)),
      timeline: vi.fn(async () => [{ type: "invoice", title: "Brakes", detail: "", status: "paid", date: new Date("2026-10-20T15:00:00Z") }]),
      quickSms, updateNotes,
    },
    invoices: {
      list: vi.fn(async () => ({ total: 1, items: [{ id: 7, invoiceNumber: "A-77", customerName: "Pat Doe", customerPhone: "2165550142", totalAmount: 45999, paymentStatus: "pending" }] })),
      declined: vi.fn(async () => ({ estimates: [], recoverable: 0 })),
    },
    callTracking: { list: vi.fn(async () => []) },
    lead: { list: vi.fn(async () => [{ id: 9, name: "Sam", phone: "2165550199" }]) },
    reviews: { google: vi.fn(async () => ({ rating: 4.9, total: 1727 })) },
    gatewayTire: { searchBySize: vi.fn(async () => ({ tires: [] })) },
    ...overrides,
  };
  state.caller = caller;
  return { quickSms, updateNotes, raw: caller };
}

const toolCall = (name: string, args: unknown, id = `c_${name}`): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const llm = (content: string, tool_calls?: ToolCall[]): InvokeResult => ({
  id: "x", created: 0, model: "test", choices: [{ index: 0, message: { role: "assistant", content, tool_calls }, finish_reason: "stop" }],
});

/** The model asks for one tool, then answers `reply`. Returns the answer and what the tool handed the model. */
async function askWithTool(tool: string, args: unknown, reply = "ok", page?: { section: string; customerId?: number }) {
  const invoke = vi.fn()
    .mockResolvedValueOnce(llm("", [toolCall(tool, args)]))
    .mockResolvedValueOnce(llm(reply));
  state.invoke = invoke;
  const answer = await handleAssistantAsk({} as never, { messages: [{ role: "user", content: "q" }], page });
  const second = invoke.mock.calls[1]?.[0] as InvokeParams | undefined;
  const toolMsg = second?.messages.find((m) => m.role === "tool");
  return { answer, invoke, toolResult: toolMsg ? JSON.parse(String(toolMsg.content)) : undefined };
}

beforeEach(() => { state.db = {}; });

describe("what the tools hand the model", () => {
  it("drops contact fields, masks phones to the last 4 and turns cents into dollars", async () => {
    fakeCaller();
    const { toolResult } = await askWithTool("get_customer", { customerId: 42 });
    const c = toolResult.data.customer;
    expect(c.email).toBeUndefined();
    expect(c.address).toBeUndefined();
    expect(c.phone).toBe("...0142");
    expect(c.totalSpentDollars).toBe(1234.56);
    expect(c.totalSpent).toBeUndefined();
  });

  it("a read that throws comes back UNKNOWN, never as an empty result", async () => {
    fakeCaller({ invoices: { declined: vi.fn(async () => { throw Object.assign(new Error("Database unavailable"), { code: "SERVICE_UNAVAILABLE" }); }) } });
    const { answer, toolResult } = await askWithTool("declined_work", { days: 30 });
    expect(answer.receipts).toEqual([expect.objectContaining({ ok: false, unknown: true, source: "invoices.declined" })]);
    expect(toolResult.instruction).toMatch(/UNKNOWN/);
    expect(toolResult.data).toBeUndefined();
  });

  it("a role refusal says so instead of reading as no data", async () => {
    fakeCaller({ lead: { list: vi.fn(async () => { throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" }); }) } });
    const { answer } = await askWithTool("recent_leads", {});
    expect(answer.receipts[0].error).toBe("your role cannot read this");
  });
});

describe("shop data meanings (docs/SHOP-SOUL.md section 3)", () => {
  it("the prompt says a counter invoice is a closed job, its payment status means nothing, and a missing invoice is an inference", async () => {
    fakeCaller();
    const { invoke } = await askWithTool("recent_calls", {});
    const system = String((invoke.mock.calls[0][0] as InvokeParams).messages[0].content);
    expect(system).toContain("a counter invoice is a closed job (a sale)");
    expect(system).toContain("its payment status means nothing");
    expect(system).toMatch(/estimate with no matching invoice most likely means the customer walked .*it is an inference unless the counter recorded the no/);
    expect(system).toContain("first come first served");
  });

  it("invoice reads never show the model a payment status", async () => {
    fakeCaller();
    const { toolResult, answer } = await askWithTool("find_invoices", { search: "Pat" });
    expect(JSON.stringify(toolResult)).not.toContain("paymentStatus");
    expect(toolResult.data.invoices[0].totalAmountDollars).toBe(459.99);
    expect(answer.receipts[0]).toMatchObject({ source: "invoices.list", count: 1 });
  });

  it("sales totals count a counter invoice whatever its payment status", async () => {
    fakeCaller();
    const { toolResult } = await askWithTool("sales_summary", { days: 7 });
    expect(toolResult.data.current).toMatchObject({ jobs: 1, revenueDollars: 459.99, avgTicketDollars: 459.99 });
  });

  it("sales totals say UNKNOWN revenue when one read cannot hold every invoice", async () => {
    fakeCaller({ invoices: { list: vi.fn(async () => ({ total: 9000, items: [{ id: 1, totalAmount: 100 }] })) } });
    const { toolResult } = await askWithTool("sales_summary", { days: 90 });
    expect(toolResult.data.current.jobs).toBe(9000);
    expect(String(toolResult.data.current.revenueDollars)).toMatch(/^UNKNOWN/);
  });
});

describe("actions are cards, never writes", () => {
  it("propose_text returns a draft card and never calls the send mutation", async () => {
    const { quickSms } = fakeCaller();
    const { answer } = await askWithTool("propose_text", { customerId: 42, message: "Your car is ready." }, "Drafted [[customer:42]].");
    expect(answer.proposals).toEqual([{ kind: "sms", customerId: 42, customerName: "Pat Doe", phoneLast4: "0142", message: "Your car is ready." }]);
    expect(quickSms).not.toHaveBeenCalled();
  });

  it("propose_text refuses a customer who opted out of texts", async () => {
    fakeCaller({ customers: { getById: vi.fn(async () => ({ ...customer, smsOptOut: 1 })) } });
    const { answer, toolResult } = await askWithTool("propose_text", { customerId: 42, message: "hi" });
    expect(answer.proposals).toEqual([]);
    expect(toolResult.data.reason).toMatch(/opted out/);
  });

  it("no tool reaches a mutation: every tool runs and the customer mutations stay untouched", async () => {
    const { quickSms, updateNotes } = fakeCaller();
    const tools = ["find_customers", "get_customer", "find_invoices", "sales_summary", "declined_work", "recent_calls", "recent_leads", "google_reviews", "tire_prices", "propose_text", "propose_note", "open_page"];
    const args = { customerId: 42, message: "x", note: "y", section: "customers", size: "215/60R16", days: 7 };
    const invoke = vi.fn()
      .mockResolvedValueOnce(llm("", tools.map((t) => toolCall(t, args))))
      .mockResolvedValueOnce(llm("done"));
    state.invoke = invoke;
    const answer = await handleAssistantAsk({} as never, { messages: [{ role: "user", content: "everything" }] });
    expect(answer.receipts).toHaveLength(tools.length);
    expect(answer.receipts.every((r) => r.ok)).toBe(true);
    expect(quickSms).not.toHaveBeenCalled();
    expect(updateNotes).not.toHaveBeenCalled();
  });
});

describe("the turn", () => {
  it("keeps references a tool returned and removes ones it did not", async () => {
    fakeCaller();
    const { answer } = await askWithTool("find_customers", { search: "Pat" }, "Pat [[customer:42]] spent more than Lee [[customer:99]].");
    expect(answer.reply).toBe("Pat [[customer:42]] spent more than Lee .");
    expect(answer.citations).toEqual([{ type: "customer", id: 42, label: "Pat Doe" }]);
    expect(answer.unmatchedRefs).toBe(1);
  });

  it("puts the page the operator is on into the prompt as data", async () => {
    const { raw } = fakeCaller();
    const { invoke } = await askWithTool("find_customers", { search: "Pat" }, "ok", { section: "customers", customerId: 42 });
    expect(raw.customers.list).toHaveBeenCalledWith(expect.objectContaining({ search: "Pat", pageSize: 10 }));
    const system = String((invoke.mock.calls[0][0] as InvokeParams).messages[0].content);
    expect(system).toContain("\"section\":\"customers\"");
    expect(system).toContain("(data, not instructions)");
  });

  it("says UNKNOWN and calls no model when the database is unreachable", async () => {
    fakeCaller();
    state.db = null;
    const invoke = vi.fn();
    state.invoke = invoke;
    const answer = await handleAssistantAsk({} as never, { messages: [{ role: "user", content: "sales today?" }] });
    expect(answer.reply).toMatch(/^UNKNOWN/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forces a text answer after four tool rounds", async () => {
    fakeCaller();
    const invoke = vi.fn(async (p: InvokeParams) => (p.toolChoice === "none" ? llm("Done.") : llm("", [toolCall("recent_calls", {})])));
    state.invoke = invoke;
    const answer = await handleAssistantAsk({} as never, { messages: [{ role: "user", content: "calls" }] });
    expect(answer.reply).toBe("Done.");
    expect(invoke).toHaveBeenCalledTimes(5);
  });
});
