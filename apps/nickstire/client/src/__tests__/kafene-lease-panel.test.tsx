/**
 * Admin Tire Orders: the Kafene lease on an order (server/routers/kafene.ts, admin status /
 * activate / cancel). Activation starts Kafene's funding to the shop, so it sits behind the house
 * ConfirmDialog and only a signed lease can be activated. A failed status read is "unknown",
 * never "no lease". Buttons need money.manage; the status needs money.view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  security: { data: { adminRole: "owner" } as any, isLoading: false, isError: false },
  config: { data: { enabled: true } as any, isLoading: false, isError: false },
  status: { data: undefined as any, isLoading: false, isError: false },
  refetch: vi.fn(),
  activate: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("framer-motion", () => {
  const cache = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_t, prop) => {
      const tag = typeof prop === "string" ? prop : "div";
      if (!cache.has(tag)) {
        cache.set(tag, React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, ...rest } = props;
          return React.createElement(tag, { ...rest, ref });
        }));
      }
      return cache.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: () => {
      if (key === "adminSecurity.status") return h.security;
      if (key === "kafene.config") return h.config;
      if (key === "kafene.status") return { ...h.status, refetch: h.refetch };
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    },
    useMutation: () => {
      const fn = key === "kafene.activate" ? h.activate : key === "kafene.cancel" ? h.cancel : vi.fn();
      return { mutate: vi.fn(), mutateAsync: (...a: any[]) => fn(...a), isPending: false };
    },
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => ({}) : new Proxy({}, { get: (_t2, p) => proc(`${String(ns)}.${String(p)}`) }),
  });
  return { trpc };
});

const ORDER = { orderNumber: "TO-20261018-077" };
const lease = (over: Record<string, unknown> = {}) => ({
  id: 1, orderNumber: ORDER.orderNumber, uid: "app_7Hk2", status: "signed", merchandiseCents: 60000,
  activationDate: null, activatedAt: null, activatedBy: null, cancelledAt: null, lastError: null, ...over,
});
const ACTIVATE_TEXT = "This tells Kafene the tires are installed and starts their funding to the shop (about 2 business days). Only after the customer has the tires.";

async function renderPanel() {
  const { default: KafeneLeasePanel } = await import("@/components/admin/KafeneLeasePanel");
  const { default: ConfirmDialog } = await import("@/components/admin/ConfirmDialog");
  render(React.createElement(React.Fragment, null, React.createElement(KafeneLeasePanel, { order: ORDER }), React.createElement(ConfirmDialog)));
}

const region = () => screen.queryByRole("region", { name: "Kafene lease" });
const panel = () => within(region()!);
const activateButton = () => panel().queryByRole("button", { name: "Activate lease (tires installed)" }) as HTMLButtonElement | null;
const confirmYes = async (label: string) => {
  await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: label })); });
};

describe("KafeneLeasePanel", () => {
  beforeEach(() => {
    h.security = { data: { adminRole: "owner" }, isLoading: false, isError: false };
    h.config = { data: { enabled: true }, isLoading: false, isError: false };
    h.status = { data: { ok: true, lease: lease() }, isLoading: false, isError: false };
    h.refetch.mockReset();
    h.activate.mockReset().mockResolvedValue({ ok: true, status: "activated", activatedAt: "2026-10-20T14:00:00Z", activationDate: "2026-10-20" });
    h.cancel.mockReset().mockResolvedValue({ ok: true, status: "cancelled" });
  });
  afterEach(cleanup);

  it.each([
    ["status disabled", () => { h.status = { data: { ok: false, reason: "disabled" }, isLoading: false, isError: false }; }],
    ["a role without money.view", () => { h.security = { data: { adminRole: "front_desk" }, isLoading: false, isError: false }; }],
  ])("hidden entirely when %s", async (_label, arrange) => {
    arrange();
    await renderPanel();
    expect(region()).toBeNull();
  });

  it("without Kafene keys (config off) a keyless 'applied' row still shows, with no Activate or Cancel", async () => {
    h.config = { data: { enabled: false }, isLoading: false, isError: false };
    h.status = { data: { ok: true, lease: lease({ status: "applied", uid: null }) }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Application started on the website; look it up in merchant.kafene.com by phone")).toBeTruthy();
    expect(activateButton()).toBeNull();
    expect(panel().queryByRole("button", { name: "Cancel lease" })).toBeNull();
  });

  it("without Kafene keys the not_installed line is still reachable", async () => {
    h.config = { data: { enabled: false }, isLoading: false, isError: false };
    h.status = { data: { ok: false, reason: "not_installed" }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Kafene lease records are not installed yet (migration 0148).")).toBeTruthy();
  });

  it("activate_unclear says to check merchant.kafene.com, and Activate asks with the double-activation warning", async () => {
    h.status = { data: { ok: true, lease: lease({ status: "activate_unclear" }) }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Activation unclear: check this lease in merchant.kafene.com before retrying.")).toBeTruthy();
    expect(activateButton()!.disabled).toBe(false);
    await act(async () => { fireEvent.click(activateButton()!); });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Only retry if merchant.kafene.com shows the lease is NOT active. Retrying an active lease can double-activate it.",
    );
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(h.activate).not.toHaveBeenCalled();
  });

  it("not_installed is one calm line: no error styling, no retry, no buttons", async () => {
    h.status = { data: { ok: false, reason: "not_installed" }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Kafene lease records are not installed yet (migration 0148).")).toBeTruthy();
    expect(panel().queryByRole("alert")).toBeNull();
    expect(panel().queryAllByRole("button")).toHaveLength(0);
    expect(panel().queryByText("No Kafene lease on this order.")).toBeNull();
  });

  it("a thrown status read is unknown with a Retry, never 'no lease'", async () => {
    h.status = { data: undefined, isLoading: false, isError: true };
    await renderPanel();
    expect(panel().getByText("Kafene lease couldn't load; state unknown.")).toBeTruthy();
    expect(panel().queryByText("No Kafene lease on this order.")).toBeNull();
    fireEvent.click(panel().getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("a measured empty answer says there is no lease, with no buttons", async () => {
    h.status = { data: { ok: true, lease: null }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("No Kafene lease on this order.")).toBeTruthy();
    expect(activateButton()).toBeNull();
  });

  it("shows the lease status and the application id", async () => {
    await renderPanel();
    expect(panel().getByText("Signed, waiting for installation")).toBeTruthy();
    expect(panel().getByText(/app_7Hk2/)).toBeTruthy();
  });

  it("activate only after the confirm dialog with the funding text; shows the activation date", async () => {
    await renderPanel();
    expect(activateButton()!.className).toContain("min-h-12");
    await act(async () => { fireEvent.click(activateButton()!); });
    expect(h.activate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain(ACTIVATE_TEXT);
    await confirmYes("Activate lease");
    expect(h.activate).toHaveBeenCalledWith({ orderNumber: ORDER.orderNumber });
    expect(panel().getByText("Activated 2026-10-20")).toBeTruthy();
  });

  it("cancelling the confirm never activates", async () => {
    await renderPanel();
    await act(async () => { fireEvent.click(activateButton()!); });
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(h.activate).not.toHaveBeenCalled();
  });

  it("an 'applied' lease (started on the website) says where to look it up and cannot be activated", async () => {
    h.status = { data: { ok: true, lease: lease({ status: "applied", uid: null }) }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Application started on the website; look it up in merchant.kafene.com by phone")).toBeTruthy();
    expect(activateButton()!.disabled).toBe(true);
  });

  it.each(["started", "applied", "approved", "activating", "activated", "cancelled"])("activate is disabled when the lease is %s", async (status) => {
    h.status = { data: { ok: true, lease: lease({ status }) }, isLoading: false, isError: false };
    await renderPanel();
    const btn = activateButton();
    expect(btn === null || btn.disabled).toBe(true);
  });

  it("activate upstream_error shows the detail and a Retry that goes through the confirm again", async () => {
    h.activate.mockReset().mockResolvedValueOnce({ ok: false, reason: "upstream_error", detail: "Kafene activate HTTP 502" })
      .mockResolvedValue({ ok: true, status: "activated", activatedAt: "x", activationDate: "2026-10-20" });
    await renderPanel();
    await act(async () => { fireEvent.click(activateButton()!); });
    await confirmYes("Activate lease");
    expect(panel().getByText("Kafene activate HTTP 502")).toBeTruthy();
    expect(panel().getByText("Kafene did not answer. The lease is marked activation unclear: check merchant.kafene.com before retrying.")).toBeTruthy();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Retry" })); });
    expect(h.activate).toHaveBeenCalledTimes(1); // Retry asks again first
    await confirmYes("Activate lease");
    expect(h.activate).toHaveBeenCalledTimes(2);
  });

  it("not_signed from activate is one plain sentence", async () => {
    h.activate.mockReset().mockResolvedValue({ ok: false, reason: "not_signed" });
    await renderPanel();
    await act(async () => { fireEvent.click(activateButton()!); });
    await confirmYes("Activate lease");
    expect(panel().getByText("This lease is not signed, so it cannot be activated.")).toBeTruthy();
  });

  it("money.view without money.manage sees the lease but no buttons", async () => {
    h.security = { data: { adminRole: "accountant" }, isLoading: false, isError: false };
    await renderPanel();
    expect(panel().getByText("Signed, waiting for installation")).toBeTruthy();
    expect(panel().queryAllByRole("button")).toHaveLength(0);
  });

  it("cancel needs a typed reason, then the confirm, then sends the reason", async () => {
    const prompt = vi.spyOn(window, "prompt");
    await renderPanel();
    fireEvent.click(panel().getByRole("button", { name: "Cancel lease" }));
    expect(prompt).not.toHaveBeenCalled();
    const input = panel().getByLabelText("Reason for cancelling") as HTMLInputElement;
    const send = panel().getByRole("button", { name: "Cancel this lease" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Customer chose to pay by card" } });
    expect(send.disabled).toBe(false);
    await act(async () => { fireEvent.click(send); });
    expect(h.cancel).not.toHaveBeenCalled();
    await confirmYes("Cancel lease");
    expect(h.cancel).toHaveBeenCalledWith({ orderNumber: ORDER.orderNumber, reason: "Customer chose to pay by card" });
    expect(panel().getByText("Lease cancelled.")).toBeTruthy();
    prompt.mockRestore();
  });

  it("cancel conflict is a plain sentence and refreshes the lease", async () => {
    h.cancel.mockReset().mockResolvedValue({ ok: false, reason: "conflict" });
    await renderPanel();
    fireEvent.click(panel().getByRole("button", { name: "Cancel lease" }));
    fireEvent.change(panel().getByLabelText("Reason for cancelling"), { target: { value: "Duplicate" } });
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Cancel this lease" })); });
    await confirmYes("Cancel lease");
    expect(panel().getByText("The lease changed while cancelling; refreshing.")).toBeTruthy();
    expect(h.refetch).toHaveBeenCalled();
  });
});
