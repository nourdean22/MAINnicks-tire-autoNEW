import { describe, it, expect, vi } from "vitest";
import { ASSISTANT_TOOLS, adminAssistantTurn, minimize, runAssistantTool, verifyCitations } from "./assistant";
import type { InvokeResult, ToolCall } from "../../_core/llm";

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
  return { caller: caller as never, quickSms, updateNotes, raw: caller };
}

const toolCall = (name: string, args: unknown, id = `c_${name}`): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const llm = (content: string, tool_calls?: ToolCall[]): InvokeResult => ({
  id: "x", created: 0, model: "test", choices: [{ index: 0, message: { role: "assistant", content, tool_calls }, finish_reason: "stop" }],
});

describe("admin assistant tools", () => {
  it("minimize drops contact fields, masks phones to the last 4 and turns cents into dollars", () => {
    const out = minimize(customer) as Record<string, unknown>;
    expect(out.email).toBeUndefined();
    expect(out.address).toBeUndefined();
    expect(out.phone).toBe("...0142");
    expect(out.totalSpentDollars).toBe(1234.56);
    expect(out.totalSpent).toBeUndefined();
  });

  it("a read that throws comes back UNKNOWN with an instruction, never as an empty result", async () => {
    const { caller } = fakeCaller({ invoices: { declined: vi.fn(async () => { throw Object.assign(new Error("Database unavailable"), { code: "SERVICE_UNAVAILABLE" }); }) } });
    const run = await runAssistantTool(caller, "declined_work", { days: 30 });
    expect(run.receipt).toMatchObject({ ok: false, unknown: true, source: "invoices.declined" });
    expect(JSON.stringify(run.result)).toContain("UNKNOWN");
  });

  it("a role refusal says so instead of reading as no data", async () => {
    const { caller } = fakeCaller({ lead: { list: vi.fn(async () => { throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" }); }) } });
    const run = await runAssistantTool(caller, "recent_leads", {});
    expect(run.receipt.error).toBe("your role cannot read this");
  });

  it("find_invoices strips counter payment status (it means nothing) and cites invoices", async () => {
    const { caller } = fakeCaller();
    const run = await runAssistantTool(caller, "find_invoices", { search: "Pat" });
    expect(JSON.stringify(run.result)).not.toContain("paymentStatus");
    expect(JSON.stringify(run.result)).toContain("\"totalAmountDollars\":459.99");
    expect(run.citations).toEqual([{ type: "invoice", id: 7, label: "A-77" }]);
  });

  it("sales_summary counts a counter invoice whatever its payment status", async () => {
    const { caller } = fakeCaller();
    const run = await runAssistantTool(caller, "sales_summary", { days: 7 });
    const data = (run.result as { data: { current: Record<string, unknown> } }).data.current;
    expect(data).toMatchObject({ jobs: 1, revenueDollars: 459.99, avgTicketDollars: 459.99 });
  });

  it("sales_summary says UNKNOWN revenue when one read cannot hold every invoice", async () => {
    const { caller } = fakeCaller({ invoices: { list: vi.fn(async () => ({ total: 9000, items: [{ id: 1, totalAmount: 100 }] })) } });
    const run = await runAssistantTool(caller, "sales_summary", { days: 90 });
    const data = (run.result as { data: { current: Record<string, unknown> } }).data.current;
    expect(data.jobs).toBe(9000);
    expect(String(data.revenueDollars)).toMatch(/^UNKNOWN/);
  });

  it("propose_text returns a draft card and never calls the send mutation", async () => {
    const { caller, quickSms } = fakeCaller();
    const run = await runAssistantTool(caller, "propose_text", { customerId: 42, message: "Your car is ready." });
    expect(run.proposal).toEqual({ kind: "sms", customerId: 42, customerName: "Pat Doe", phoneLast4: "0142", message: "Your car is ready." });
    expect(quickSms).not.toHaveBeenCalled();
  });

  it("propose_text refuses a customer who opted out of texts", async () => {
    const { caller } = fakeCaller({ customers: { getById: vi.fn(async () => ({ ...customer, smsOptOut: 1 })) } });
    const run = await runAssistantTool(caller, "propose_text", { customerId: 42, message: "hi" });
    expect(run.proposal).toBeUndefined();
    expect(JSON.stringify(run.result)).toContain("opted out");
  });

  it("no tool reaches a mutation: every tool runs and the customer mutations stay untouched", async () => {
    const { caller, quickSms, updateNotes } = fakeCaller();
    for (const t of ASSISTANT_TOOLS) await runAssistantTool(caller, t.function.name, { customerId: 42, message: "x", note: "y", section: "customers", size: "215/60R16", days: 7 });
    expect(quickSms).not.toHaveBeenCalled();
    expect(updateNotes).not.toHaveBeenCalled();
  });
});

describe("citations", () => {
  const seen = [{ type: "customer" as const, id: 42, label: "Pat Doe" }];
  it("keeps references a tool returned and removes ones it did not", () => {
    const out = verifyCitations("Pat [[customer:42]] spent more than Lee [[customer:99]].", seen);
    expect(out.reply).toBe("Pat [[customer:42]] spent more than Lee .");
    expect(out.citations).toEqual(seen);
    expect(out.unmatchedRefs).toBe(1);
  });
});

describe("adminAssistantTurn", () => {
  it("runs the tool the model asks for, then answers with verified citations", async () => {
    const { caller, raw } = fakeCaller();
    const invoke = vi.fn()
      .mockResolvedValueOnce(llm("", [toolCall("find_customers", { search: "Pat" })]))
      .mockResolvedValueOnce(llm("Pat Doe [[customer:42]] has spent $1,234.56."));
    const out = await adminAssistantTurn({ caller, invoke, messages: [{ role: "user", content: "how much has Pat spent" }], page: { section: "customers" }, dbAvailable: true });
    expect(raw.customers.list).toHaveBeenCalledWith(expect.objectContaining({ search: "Pat", pageSize: 10 }));
    expect(out.reply).toContain("[[customer:42]]");
    expect(out.citations).toHaveLength(1);
    expect(out.receipts).toEqual([expect.objectContaining({ tool: "find_customers", ok: true, count: 1 })]);
    const system = invoke.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("\"section\":\"customers\"");
    expect(system).toContain("payment status means nothing");
  });

  it("returns a draft card from propose_text without sending", async () => {
    const { caller, quickSms } = fakeCaller();
    const invoke = vi.fn()
      .mockResolvedValueOnce(llm("", [toolCall("propose_text", { customerId: 42, message: "Ready for pickup." })]))
      .mockResolvedValueOnce(llm("Drafted a text to Pat [[customer:42]]. Tap Send to send it."));
    const out = await adminAssistantTurn({ caller, invoke, messages: [{ role: "user", content: "text pat his car is ready" }], dbAvailable: true });
    expect(out.proposals).toEqual([expect.objectContaining({ kind: "sms", customerId: 42 })]);
    expect(quickSms).not.toHaveBeenCalled();
  });

  it("says UNKNOWN and calls no model when the database is unreachable", async () => {
    const { caller } = fakeCaller();
    const invoke = vi.fn();
    const out = await adminAssistantTurn({ caller, invoke, messages: [{ role: "user", content: "sales today?" }], dbAvailable: false });
    expect(out.reply).toMatch(/^UNKNOWN/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forces a text answer after four tool rounds", async () => {
    const { caller } = fakeCaller();
    const invoke = vi.fn(async (p: { toolChoice?: unknown }) => (p.toolChoice === "none" ? llm("Done.") : llm("", [toolCall("recent_calls", {})])));
    const out = await adminAssistantTurn({ caller, invoke, messages: [{ role: "user", content: "calls" }], dbAvailable: true });
    expect(out.reply).toBe("Done.");
    expect(invoke).toHaveBeenCalledTimes(5);
  });
});
