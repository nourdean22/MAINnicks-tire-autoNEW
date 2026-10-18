/**
 * With site data blocked, every localStorage call throws. Each site-wide widget
 * that remembers a dismissal must still mount: before 5d9607bc3, NotificationBar
 * and ReviewCTA threw on mount and took the whole page down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/tires", vi.fn()],
  useSearch: () => "",
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useReducedMotion: () => true,
}));

vi.mock("@/lib/trpc", () => {
  const proc = () => ({
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => ({}) : new Proxy({}, { get: () => proc() }),
  });
  return { trpc };
});

vi.mock("@/components/SEO", () => ({ trackEvent: vi.fn(), trackPhoneClick: vi.fn() }));

const WIDGETS: Array<[string, () => Promise<{ default: React.ComponentType }>]> = [
  ["NotificationBar", () => import("@/components/NotificationBar")],
  ["ReviewCTA", () => import("@/components/ReviewCTA")],
  ["ExitIntentModal", () => import("@/components/conversion/ExitIntentModal")],
  ["UrgencyWidget", () => import("@/components/conversion/UrgencyWidget")],
  ["FomoTicker", () => import("@/components/FomoTicker")],
];

describe("site-wide widgets with localStorage blocked", () => {
  beforeEach(() => {
    const blocked = () => { throw new Error("SecurityError: storage blocked"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(WIDGETS)("%s mounts without throwing", async (_name, load) => {
    const { default: Widget } = await load();
    // act flushes the mount effects, where the storage reads live.
    await act(async () => { render(React.createElement(Widget)); });
    expect(Storage.prototype.getItem).toHaveBeenCalled(); // the guard was actually exercised
  });
});
