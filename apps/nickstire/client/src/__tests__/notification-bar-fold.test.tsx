/**
 * NotificationBar — on a phone the card waits until the first screen has
 * been scrolled past; on desktop it shows at once.
 *
 * WHY (2026-09-08): at 375×812 the card (fixed 84px above the mobile CTA bar)
 * covered the hero's "Talk to a human" intent card — the one carrying the
 * phone number — from the first frame. Screenshots in PR #2190.
 *
 * control = desktop → rendered immediately; canary = phone → absent until a
 * scroll past 60% of the viewport, then present.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href, ...p }: any) => React.createElement("a", { href, ...p }, children),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: () => new Proxy({}, {
      get: () => ({
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      }),
    }),
  }),
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: (_t, tag) => React.forwardRef((props: any, ref: any) => {
      const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, ...rest } = props;
      return React.createElement(tag as string, { ...rest, ref });
    }),
  }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

const originalMatchMedia = window.matchMedia;
function pretendViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
function setScroll(y: number, innerHeight = 812) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true, writable: true });
}

describe("NotificationBar · first-screen gate", () => {
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    setScroll(0);
    localStorage.removeItem("nicks-notif-dismissed");
  });

  it("control: desktop renders the card immediately", async () => {
    pretendViewport(false);
    setScroll(0);
    const { default: NotificationBar } = await import("../components/NotificationBar");
    render(React.createElement(NotificationBar));
    expect(screen.getByRole("button", { name: /dismiss notification/i })).toBeTruthy();
  });

  it("canary: a phone shows nothing at scroll-top, then the card after scrolling past 60% of the viewport", async () => {
    pretendViewport(true);
    setScroll(0, 812);
    const { default: NotificationBar } = await import("../components/NotificationBar");
    render(React.createElement(NotificationBar));
    expect(screen.queryByRole("button", { name: /dismiss notification/i })).toBeNull();

    await act(async () => {
      setScroll(300, 812); // 37% — still on the first screen
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("button", { name: /dismiss notification/i })).toBeNull();

    await act(async () => {
      setScroll(600, 812); // 74% — past the hero
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("button", { name: /dismiss notification/i })).toBeTruthy();
  });
});
