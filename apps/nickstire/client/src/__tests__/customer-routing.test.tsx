import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// Configurable tRPC mock
const trpcState = vi.hoisted(() => ({
  queries: {} as Record<string, { data?: unknown; isLoading?: boolean; error?: unknown; fetchStatus?: string }>,
  mode: "ok" as "ok" | "loading" | "error",
  mutate: vi.fn(),
  refetch: vi.fn(),
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
      fetchStatus: c.fetchStatus ?? "idle",
      refetch: trpcState.refetch,
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
  const utils = (): unknown =>
    new Proxy({}, {
      get: () => new Proxy({}, {
        get: () => ({ invalidate: vi.fn().mockResolvedValue(undefined), refetch: vi.fn(), cancel: vi.fn(), setData: vi.fn() }),
      }),
    });
  const trpc = new Proxy({}, {
    get: (_t, ns) => {
      if (ns === "useUtils" || ns === "useContext") return utils;
      return new Proxy({}, { get: (_t2, proc) => procedure(`${String(ns)}.${String(proc)}`) });
    },
  });
  return { trpc };
});

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

describe("Customers Routing & Deep-Linking", () => {
  beforeEach(() => {
    // Customers decides its tabs from the role (innerTabs.ts) since 2026-10-19.
    trpcState.queries = { "adminSecurity.status": { data: { adminRole: "owner", permissions: [] } } };
    trpcState.mode = "ok";
    trpcState.refetch.mockClear();
    trpcState.mutate.mockClear();
    // Clear URL query parameters before each test
    window.history.pushState({}, "", "/admin");
  });

  afterEach(cleanup);

  it("opens the customer profile if deep-linked via URL (tab=customers&id=123)", async () => {
    // Setup queries
    trpcState.queries["customers.stats"] = { data: { total: 10 } };
    trpcState.queries["intelligence.serviceAffinity"] = { data: { affinities: [] } };
    trpcState.queries["customers.getById"] = {
      data: {
        id: 123,
        firstName: "Deep",
        lastName: "Linked",
        phone: "555-0100",
        email: "deep@example.com",
        totalSpent: 5000,
        totalVisits: 2,
        isVip: false,
      },
    };
    trpcState.queries["customers.timeline"] = { data: [] };
    trpcState.queries["customers.history"] = { data: { invoices: [], declinedEstimates: [], openWorkOrders: [] } };

    // Deep link URL
    window.history.pushState({}, "", "/admin?tab=customers&id=123");

    const { default: CustomersSection } = await import("../pages/admin/CustomersSection");
    render(React.createElement(CustomersSection));

    // Verify CustomerProfile is rendered
    expect(await screen.findByText("Deep Linked")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search name, phone, email/i)).toBeNull();
  });

  it("clears URL parameter and goes back to list when onClose is triggered", async () => {
    trpcState.queries["customers.stats"] = { data: { total: 10 } };
    trpcState.queries["intelligence.serviceAffinity"] = { data: { affinities: [] } };
    trpcState.queries["customers.getById"] = {
      data: {
        id: 123,
        firstName: "Deep",
        lastName: "Linked",
        phone: "555-0100",
        totalSpent: 5000,
        totalVisits: 2,
      },
    };
    trpcState.queries["customers.timeline"] = { data: [] };
    trpcState.queries["customers.history"] = { data: { invoices: [], declinedEstimates: [], openWorkOrders: [] } };

    window.history.pushState({}, "", "/admin?tab=customers&id=123");

    const { default: CustomersSection } = await import("../pages/admin/CustomersSection");
    render(React.createElement(CustomersSection));

    // Click Back to Customers
    const backBtn = await screen.findByRole("button", { name: /back to customers/i });
    fireEvent.click(backBtn);

    // Verify URL parameter was cleared
    const params = new URLSearchParams(window.location.search);
    expect(params.get("id")).toBeNull();
  });

  it("removes invalid id from URL and renders list safely", async () => {
    trpcState.queries["customers.stats"] = { data: { total: 10 } };
    trpcState.queries["intelligence.serviceAffinity"] = { data: { affinities: [] } };
    trpcState.queries["customers.list"] = {
      data: {
        customers: [],
        total: 0,
      },
    };

    window.history.pushState({}, "", "/admin?tab=customers&id=abc");

    const { default: CustomersSection } = await import("../pages/admin/CustomersSection");
    render(React.createElement(CustomersSection));

    // Should load the search input of CustomersList because 'abc' is invalid and cleared
    expect(await screen.findByPlaceholderText(/Search name, phone, email/i)).toBeTruthy();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("id")).toBeNull();
  });

  // 2026-10-19: the tabs depend on the role. A failed or paused (offline PWA) access
  // read used to leave no tab and no panel at all: a blank page that looks empty.
  it.each([
    ["errored", { error: new Error("status down") }],
    ["paused", { fetchStatus: "paused" }],
  ])("an access check that %s says so and offers Retry, never a blank page", async (_label, status) => {
    trpcState.queries["adminSecurity.status"] = status;
    window.history.pushState({}, "", "/admin?tab=customers");
    const { default: CustomersSection } = await import("../pages/admin/CustomersSection");
    render(React.createElement(CustomersSection));
    expect(screen.getByText("Could not check your access.")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.className).toMatch(/min-h-12/);
    fireEvent.click(retry);
    expect(trpcState.refetch).toHaveBeenCalledTimes(1);
  });

  it("positive control: a loaded role still gets its tabs, not the access line", async () => {
    window.history.pushState({}, "", "/admin?tab=customers&customersTab=members");
    const { default: CustomersSection } = await import("../pages/admin/CustomersSection");
    render(React.createElement(CustomersSection));
    expect(screen.queryByText("Could not check your access.")).toBeNull();
    expect(screen.getByRole("button", { name: /Members/ })).toBeTruthy();
  });
});
