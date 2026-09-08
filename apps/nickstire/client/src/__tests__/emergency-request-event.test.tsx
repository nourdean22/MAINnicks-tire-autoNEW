/**
 * EmergencyMode opens its request form on the ShopStrip's window event.
 *
 * The fixed red closed-banner that used to own that button was removed
 * (it covered the trust bar); this proves the replacement path end to end:
 * control = closed shop, no event → no form; canary = event → form;
 * second canary = shop open → component renders nothing, event is inert.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";

const hours = vi.hoisted(() => ({ isOpen: false }));

vi.mock("@/hooks/useBusinessHours", () => ({
  useBusinessHours: () => ({ isOpen: hours.isOpen, nextOpenTime: "Tomorrow at 8:00 AM", currentTime: "" }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href, ...p }: any) => React.createElement("a", { href, ...p }, children),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: () => new Proxy({}, {
      get: () => ({
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      }),
    }),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useFocusTrap", () => ({ useFocusTrap: () => {} }));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: (_t, tag) => React.forwardRef((props: any, ref: any) => {
      const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, ...rest } = props;
      return React.createElement(tag as string, { ...rest, ref });
    }),
  }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe("EmergencyMode ← ShopStrip event", () => {
  afterEach(() => { cleanup(); hours.isOpen = false; });

  it("control: closed shop, no event → the form is not open (only the floating button)", async () => {
    const { EmergencyMode } = await import("../components/EmergencyMode");
    render(React.createElement(EmergencyMode));
    expect(screen.getByRole("button", { name: /open emergency request form/i })).toBeTruthy();
    expect(screen.queryByText(/EMERGENCY REQUEST/)).toBeNull();
    expect(screen.queryByText(/re-opens/)).toBeNull(); // the old banner is gone
  });

  it("canary: the window event opens the form", async () => {
    const { EmergencyMode } = await import("../components/EmergencyMode");
    const { EMERGENCY_REQUEST_EVENT } = await import("../components/ShopStrip");
    render(React.createElement(EmergencyMode));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EMERGENCY_REQUEST_EVENT));
    });
    // The submit button also says "EMERGENCY REQUEST"; the dialog heading is the proof.
    expect(screen.getByRole("heading", { name: /EMERGENCY REQUEST/ })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("canary: with the shop open the component renders nothing and the event is inert", async () => {
    hours.isOpen = true;
    const { EmergencyMode } = await import("../components/EmergencyMode");
    const { EMERGENCY_REQUEST_EVENT } = await import("../components/ShopStrip");
    const { container } = render(React.createElement(EmergencyMode));
    expect(container.innerHTML).toBe("");
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EMERGENCY_REQUEST_EVENT));
    });
    expect(screen.queryByText(/EMERGENCY REQUEST/)).toBeNull();
  });
});
