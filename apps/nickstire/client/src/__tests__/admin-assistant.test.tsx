/**
 * The admin assistant sheet (docs/ADMIN-ASSISTANT.md): page context, record chips, the phone Ask slot, and the
 * rule that a drafted text goes out only when the operator taps Send, through the existing customers.quickSms.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const askMutateAsync = vi.fn();
const smsMutateAsync = vi.fn();
const notesMutateAsync = vi.fn();
vi.mock("@/lib/trpc", () => {
  const mutation = (mutateAsync: (...a: unknown[]) => unknown) => () => ({ mutateAsync, mutate: vi.fn(), isPending: false });
  return {
    trpc: {
      nickActions: { ask: { useMutation: mutation((...a) => askMutateAsync(...a)) } },
      customers: {
        quickSms: { useMutation: mutation((...a) => smsMutateAsync(...a)) },
        updateNotes: { useMutation: mutation((...a) => notesMutateAsync(...a)) },
      },
      useUtils: () => ({ customers: { getById: { fetch: vi.fn(async () => ({ notes: "old" })), invalidate: vi.fn() } } }),
    },
  };
});

import { AdminAssistant, buildPageContext, openAdminAssistant, pageLabel, splitReply } from "@/components/admin/AdminAssistant";
import { AdminTabBar } from "@/components/admin/AdminTabBar";
import { UNBATCHED_SLOW_PROCEDURES } from "@/lib/unbatchedProcedures";

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("request routing", () => {
  it("the ask call gets its own request so a slow answer never holds the page's batched reads", () => {
    expect(UNBATCHED_SLOW_PROCEDURES.has("nickActions.ask")).toBe(true);
  });
});

describe("page context envelope", () => {
  it("keeps tab, id and *Tab params and names the customer in view only on Customers", () => {
    const page = buildPageContext("customers", "Customers", "?tab=customers&id=42&customersTab=members&secret=x");
    expect(page).toEqual({ section: "customers", title: "Customers", params: { tab: "customers", id: "42", customersTab: "members" }, customerId: 42 });
    expect(pageLabel(page)).toBe("Customers · customer #42");
    expect(buildPageContext("money", "Money", "?id=42").customerId).toBeUndefined();
  });
});

describe("reply chips", () => {
  it("turns verified references into chips and leaves text alone", () => {
    const parts = splitReply("Pat [[customer:42]] spent **$10**.", [{ type: "customer", id: 42, label: "Pat Doe" }]);
    expect(parts).toEqual([{ text: "Pat " }, { ref: { type: "customer", id: 42, label: "Pat Doe" } }, { text: " spent $10." }]);
  });
});

describe("phone tab bar", () => {
  const bar = (onAsk?: () => void) => render(<AdminTabBar role="owner" active="overview" signals={[]} onNavigate={() => {}} onSearch={() => {}} onAsk={onAsk} />);
  it("shows Ask before Search only when the shell passes onAsk, and the tap opens it", () => {
    const onAsk = vi.fn();
    bar(onAsk);
    const slots = screen.getAllByRole("button").map((b) => b.getAttribute("data-slot"));
    expect(slots.slice(-2)).toEqual(["ask", "search"]);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
  it("has no Ask slot for a role the shell does not give it to", () => {
    bar(undefined);
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });
});

describe("Ask sheet", () => {
  const mount = () => render(<AdminAssistant userKey="1" section="customers" sectionTitle="Customers" allowedSections={["customers", "overview"]} onNavigate={() => {}} />);

  it("sends the page with the question, shows the draft, and texts only on tap", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    window.history.replaceState({}, "", "/admin?tab=customers&id=42");
    askMutateAsync.mockResolvedValueOnce({
      reply: "Drafted a text to Pat [[customer:42]].",
      citations: [{ type: "customer", id: 42, label: "Pat Doe" }],
      proposals: [{ kind: "sms", customerId: 42, customerName: "Pat Doe", phoneLast4: "0142", message: "Your car is ready." }],
      receipts: [{ tool: "propose_text", source: "customers.getById", ok: true, unknown: false, count: 1 }],
      unmatchedRefs: 0,
    });
    smsMutateAsync.mockResolvedValueOnce({ success: true });
    mount();
    act(() => openAdminAssistant());
    fireEvent.change(await screen.findByLabelText("Ask a question"), { target: { value: "text this customer his car is ready" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const send = await screen.findByRole("button", { name: "Send text to Pat Doe" });
    expect(askMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      page: expect.objectContaining({ section: "customers", customerId: 42 }),
      messages: [{ role: "user", content: "text this customer his car is ready" }],
    }));
    expect(screen.getByRole("button", { name: "Pat Doe" })).toBeTruthy();
    expect(smsMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Text message"), { target: { value: "Your car is ready, Pat." } });
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByText("Sent: text to Pat Doe.")).toBeTruthy());
    expect(smsMutateAsync).toHaveBeenCalledWith({ customerId: 42, message: "Your car is ready, Pat." });
    expect(screen.queryByRole("button", { name: "Send text to Pat Doe" })).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("dropping the page chip sends the question without the page", async () => {
    askMutateAsync.mockResolvedValueOnce({ reply: "UNKNOWN", citations: [], proposals: [], receipts: [], unmatchedRefs: 0 });
    mount();
    act(() => openAdminAssistant());
    fireEvent.click(await screen.findByRole("button", { name: "Do not send this page with my question" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "sales?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askMutateAsync).toHaveBeenCalled());
    expect(askMutateAsync.mock.calls[0][0].page).toBeUndefined();
  });

  it("a failed read is shown as UNKNOWN, not hidden", async () => {
    askMutateAsync.mockResolvedValueOnce({
      reply: "Sales: UNKNOWN.", citations: [], proposals: [], unmatchedRefs: 0,
      receipts: [{ tool: "sales_summary", source: "invoices.stats", ok: false, unknown: true, error: "Database unavailable" }],
    });
    mount();
    act(() => openAdminAssistant());
    fireEvent.change(await screen.findByLabelText("Ask a question"), { target: { value: "sales?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("UNKNOWN: invoices.stats failed (Database unavailable)")).toBeTruthy();
  });
});
