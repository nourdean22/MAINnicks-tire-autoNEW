/**
 * EVALUATOR: the home hero's experiment instrumentation must keep firing.
 *
 * This file is an evaluator path (config/agent-os/evaluator-paths.json). It
 * pins the three customer_events writes the web-experiment resolver counts —
 * the primary metric on the tires lane, the two guardrails on the phone and
 * drop-off lanes — so a candidate change to Home.tsx that drops or renames
 * one of them fails here instead of silently emptying an arm.
 *
 * Positive control first: the primary write is asserted by exact element name
 * so a rename to "hero-primary" would fail, not pass by prefix.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/", vi.fn()],
  useRoute: () => [false, null],
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...p }: any) => React.createElement(tag === "div" || tag === "section" || tag === "span" || tag === "a" ? tag : "div", strip(p), children) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useReducedMotion: () => true,
  useInView: () => true,
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));
function strip(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (!/^(initial|animate|exit|transition|whileInView|viewport|variants|whileHover|whileTap|layout)$/.test(k)) out[k] = v;
  return out;
}
const mockQueryResult = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) })
      : new Proxy({}, { get: () => ({
          useQuery: () => mockQueryResult,
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }) }),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));

function conversionPosts(): Array<{ type: string; element?: string; props?: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) === "/api/analytics/conversion")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

async function renderHome() {
  const { default: Home } = await import("../pages/Home");
  return render(React.createElement(Home));
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.setItem("nick_session_id", "s_test_visitor");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem("nick_session_id");
});

async function postsToInclude(pred: (p: { type: string; element?: string }) => boolean) {
  await vi.waitFor(() => expect(conversionPosts().some(pred)).toBe(true), { timeout: 3000 });
}

describe("hero experiment instrumentation (evaluator)", () => {
  it("the tires primary lane writes page_cta_primary_clicked with element hero-primary-lane and an armId", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("link", { name: /get tires now/i }));
    await postsToInclude((p) => p.type === "page_cta_primary_clicked" && p.element === "hero-primary-lane");
    const post = conversionPosts().find((p) => p.type === "page_cta_primary_clicked")!;
    expect(post.props).toMatchObject({ experimentId: "home-hero-subline-2026-09", armId: expect.stringMatching(/^(control|variant)$/) });
    expect((post as { sessionId?: string }).sessionId).toBe("s_test_visitor");
  });
  it("the phone lane writes the phone_number_clicked guardrail", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("link", { name: /talk to a human/i }));
    await postsToInclude((p) => p.type === "phone_number_clicked" && p.element === "hero-router");
  });
  it("the drop-off lane writes the page_cta_secondary_clicked guardrail", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("link", { name: /dropping off/i }));
    await postsToInclude((p) => p.type === "page_cta_secondary_clicked" && p.element === "hero-dropoff");
  });
  it("with the experiment inactive, control renders and NO exposure is logged", async () => {
    await renderHome();
    expect(screen.getByText("Search your size · see installed prices · request online")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(conversionPosts().some((p) => p.type === "experiment_exposure")).toBe(false);
  });
});
