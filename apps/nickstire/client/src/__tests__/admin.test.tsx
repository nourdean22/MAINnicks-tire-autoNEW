/**
 * Admin test suite — regression guards + section render matrix.
 *
 * Two jobs:
 *
 *  1. REGRESSION GUARDS — lock in the real bugs found by the
 *     modern-JS-patterns audit so a future refactor can't silently
 *     reintroduce them. Each test here FAILS against the pre-fix code
 *     and PASSES against the fix. A test that can't fail is worthless
 *     (see `smoke.test.tsx`'s "Admin renders" — it renders the shell
 *     with all-undefined data and only catches white-screen crashes,
 *     so it never saw any of these bugs).
 *
 *  2. SECTION RENDER MATRIX — every admin section is mounted against
 *     three data states (loaded-but-empty / loading / error). This is
 *     the cheap, broad guard for the crash-on-undefined class: a
 *     missing `?.` on API data is a white screen for the operator.
 *
 * The tRPC mock below is data-configurable per test (smoke.test.tsx's
 * mock is fixed at `data: undefined`) — set `trpcState.queries[key]`
 * or `trpcState.mode` before rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Configurable tRPC mock ─────────────────────────────────────────
// vi.mock is hoisted; the factory closes over this hoisted state, so a
// test can stage per-query data (or a global loading/error mode) before
// it renders. Reset in beforeEach.
const trpcState = vi.hoisted(() => ({
  // "namespace.procedure" -> the result that procedure's useQuery returns
  queries: {} as Record<string, { data?: unknown; isLoading?: boolean; error?: unknown }>,
  // global override — "ok" uses `queries`, "loading"/"error" force every query
  mode: "ok" as "ok" | "loading" | "error",
  // shared mutation spy — assert a button actually fired a mutation
  mutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const queryResult = (key: string) => {
    if (trpcState.mode === "loading") {
      return { data: undefined, isLoading: true, isPending: true, isError: false, error: null, refetch: vi.fn() };
    }
    if (trpcState.mode === "error") {
      return { data: undefined, isLoading: false, isPending: false, isError: true, error: new Error("test error"), refetch: vi.fn() };
    }
    const c = trpcState.queries[key] ?? {};
    return {
      data: c.data,
      isLoading: c.isLoading ?? false,
      isPending: c.isLoading ?? false,
      isError: c.error != null,
      isSuccess: c.error == null && c.data !== undefined,
      error: c.error ?? null,
      refetch: vi.fn(),
    };
  };
  const procedure = (key: string) => ({
    useQuery: () => queryResult(key),
    useInfiniteQuery: () => queryResult(key),
    useSuspenseQuery: () => ({ data: trpcState.queries[key]?.data }),
    useMutation: () => ({
      mutate: trpcState.mutate,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isLoading: false,
      isError: false,
      reset: vi.fn(),
    }),
  });
  // utils proxy — trpc.useUtils().<ns>.<proc>.invalidate()
  const utils = (): unknown =>
    new Proxy({}, {
      get: () => new Proxy({}, {
        get: () => ({ invalidate: vi.fn().mockResolvedValue(undefined), refetch: vi.fn(), cancel: vi.fn(), setData: vi.fn() }),
      }),
    });
  const trpc = new Proxy({}, {
    get: (_t, ns) => {
      if (ns === "useUtils" || ns === "useContext") return utils;
      // trpc.<ns>.<proc>.useQuery()
      return new Proxy({}, { get: (_t2, proc) => procedure(`${String(ns)}.${String(proc)}`) });
    },
  });
  return { trpc };
});

// ─── Non-tRPC mocks (fixed) — mirror smoke.test.tsx ─────────────────
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => ["/admin", vi.fn()],
  useRoute: () => [true, {}],
  useParams: () => ({}),
  useSearch: () => window.location.search,
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
      const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
      return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
    }),
  }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0, on: () => vi.fn() } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

beforeEach(() => {
  trpcState.queries = {};
  trpcState.mode = "ok";
  trpcState.mutate.mockClear();
});
afterEach(cleanup);

// ════════════════════════════════════════════════════════════════════
// 1. REGRESSION GUARDS
// ════════════════════════════════════════════════════════════════════
describe("Admin — regression guards", () => {
  /**
   * BUG: DispatchSection rendered `qcStats?.passRate || 100`. A real
   * pass rate of 0 (every QC check failed) is falsy, so `0 || 100`
   * fell through to 100 — the dashboard showed a fake green "100%"
   * exactly when quality was worst. Fix: `?? 100`.
   */
  it("DispatchSection: a real 0% QC pass rate renders as 0%, not a fake 100%", async () => {
    trpcState.queries["dispatch.qcStats"] = {
      data: { passRate: 0, qcPending: 0, comebacks30d: 0 },
    };
    const { default: DispatchSection } = await import("../pages/admin/money/DispatchSection");
    render(React.createElement(DispatchSection));

    const label = screen.getByText("QC Pass Rate");
    const card = label.parentElement as HTMLElement;
    // the value div precedes the label div inside the metric card.
    // pre-fix code (`passRate || 100`) renders "100%" here — a fake green.
    const value = card.firstElementChild as HTMLElement;
    expect(value.textContent).toBe("0%");
  });

  /**
   * BUG: LeadsSection used window.prompt() to capture lead notes /
   * lost-reason. prompt() is suppressed in iOS PWA standalone mode
   * (the admin's real operating environment) — it returns null, the
   * guard fires, and the mutation never runs. Marking a lead silently
   * did nothing on the phone. Fix: inline expandable input components.
   */
  it("LeadsSection: marking a lead contacted never calls window.prompt — it opens an inline input", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    trpcState.queries["lead.list"] = {
      data: [{
        id: 1, name: "Regression Test Lead", phone: "2165550100",
        status: "new", source: "chat", urgencyScore: 3,
        createdAt: new Date().toISOString(),
      }],
    };
    const { default: LeadsSection } = await import("../pages/admin/LeadsSection");
    render(React.createElement(LeadsSection));

    // whichever "mark contacted/called" control renders for a new lead
    const markBtn = screen
      .getAllByRole("button")
      .find((b) => /mark (contacted|called)/i.test(b.textContent || ""));
    expect(markBtn, "a mark-contacted button should render for a new lead").toBeTruthy();

    fireEvent.click(markBtn!);

    // the fix — an inline notes input, NOT a native prompt
    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/contact notes/i)).toBeTruthy();
    promptSpy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════════════
// 1b. CUSTOMER-SITE REGRESSION GUARDS
// Customer-facing components live outside pages/admin; their regression
// tests reuse the same mock harness above.
// ════════════════════════════════════════════════════════════════════
describe("Customer site — regression guards", () => {
  /**
   * BUG: TireFinder's OrderModal had no Escape-key handler. Only the X
   * button and backdrop click closed it — standard keyboard/a11y
   * expectation was missing. The fix wired a window keydown listener
   * inside the modal's useEffect that calls onClose on Escape.
   */
  it("TireFinder OrderModal: Escape key closes the modal (calls onClose)", async () => {
    const { OrderModal } = await import("../pages/TireFinder");
    const onClose = vi.fn();
    const tire = {
      name: "TestBrand TestModel",
      brand: "TestBrand",
      model: "TestModel",
      size: "215/60R16",
      shopPrice: 100,
      pricePerTireCents: 10000,
    };
    render(React.createElement(OrderModal, {
      tire,
      quantity: 4,
      packageValue: 266,
      onClose,
    }));

    // Pre-fix code had no Escape listener — onClose would NOT have been
    // called by this keydown. Now it is. revert-check this test by
    // temporarily commenting out the useEffect in TireFinder and
    // confirming it FAILS for the right reason.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * REGRESSION TEST: TireFinder search size-duplication & URL sync
   * Checks that searchInput is updated when the URL ?size parameter changes.
   */
  it("TireFinder: syncs searchInput with urlSize parameter changes", async () => {
    // Legacy-page behavior: the mounted page re-syncs its input when the URL
    // ?size changes across rerenders. The shipped V2 funnel reads ?size on
    // mount (covered in tire-finder-v2.test.tsx); this guards the legacy page.
    // Stage URL with a size
    window.history.pushState({}, "", "/tires?size=225/65R17");

    const { default: TireFinder } = await import("../pages/TireFinderLegacy");
    const { rerender } = render(React.createElement(TireFinder));

    const input = screen.getByLabelText("Search tire size") as HTMLInputElement;
    expect(input.value).toBe("225/65R17");

    // Change URL size parameter and rerender
    window.history.pushState({}, "", "/tires?size=205/55R16");
    rerender(React.createElement(TireFinder));

    expect(input.value).toBe("205/55R16");

    // Clean up
    window.history.pushState({}, "", "/");
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. SECTION RENDER MATRIX
// Every admin section × {loaded-empty, loading, error}. Catches the
// crash-on-undefined class — a missing `?.` on API data is a white
// screen for the operator. import.meta.glob auto-covers new sections.
//
// 2026-07-04 maintainability audit: was "../pages/admin/*.tsx" — a
// single-level glob that silently excluded every nested section
// (money/, outreach/, settings/, customers/, etc. — 78 of 113 admin
// files, including the largest untested ones: money/WorkOrdersSection
// at 1,062 lines, outreach/SmsSection at 1,171). The docstring above
// claimed "every admin section" while 69% were invisible to it.
// "**/*.tsx" covers the whole tree; "shared/**" is excluded below since
// those are library modules, not renderable sections (mirrors the
// existing "skip modules with no default export" runtime guard, just
// cheaper to skip at glob time for the obviously-non-section ones).
// ════════════════════════════════════════════════════════════════════
describe("Admin — section render matrix", () => {
  const sectionModules = import.meta.glob(
    ["../pages/admin/**/*.tsx", "!../pages/admin/shared/**"],
  );

  for (const [path, loadModule] of Object.entries(sectionModules)) {
    const name = path.split("/").pop()!.replace(/\.tsx$/, "");
    for (const mode of ["ok", "loading", "error"] as const) {
      it(`${name} renders without crashing (${mode} data)`, async () => {
        trpcState.mode = mode;
        const mod = (await loadModule()) as { default?: unknown };
        // skip helper modules with no renderable default export (shared.tsx)
        if (typeof mod.default !== "function") return;
        const Section = mod.default as React.ComponentType;
        // Almost every section reads only through the mocked `trpc.*`
        // hooks above, which need no provider. IntelligenceHQSection is
        // the one exception (calls raw @tanstack/react-query
        // useQueryClient() directly) — surfaced by widening this glob
        // to the nested sections. A real QueryClient here is harmless
        // for every other section and future-proofs the one nuance.
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        expect(() =>
          render(
            React.createElement(
              QueryClientProvider,
              { client: queryClient },
              React.createElement(Section),
            ),
          ),
        ).not.toThrow();
      });
    }
  }
});
