/**
 * Smoke tests — verify critical page components render without crashing.
 * These catch broken imports, missing providers, and render-time exceptions.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

// Mock wouter so page components don't need a real router
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) =>
    React.createElement("a", props, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => ["/", vi.fn()],
  useRoute: () => [true, {}],
  useParams: () => ({}),
  useSearch: () => window.location.search,
}));

// Mock framer-motion to avoid animation complexity in tests
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "div" || prop === "section" || prop === "span" || prop === "p" || prop === "h1" || prop === "h2" || prop === "h3" || prop === "a" || prop === "img" || prop === "ul" || prop === "li" || prop === "nav" || prop === "header" || prop === "footer" || prop === "main" || prop === "article" || prop === "button") {
          return React.forwardRef((props: any, ref: any) => {
            const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
            return React.createElement(prop as string, { ...rest, ref });
          });
        }
        return undefined;
      },
    }
  ),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

// Mock trpc to prevent network calls
const mockQueryResult = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
const mockMutationResult = { mutate: vi.fn(), mutateAsync: vi.fn(), isLoading: false, isPending: false };
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

const trpcRouterProxy: any = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // Top-level trpc methods
      if (prop === "useUtils" || prop === "useContext") {
        return () =>
          new Proxy(
            {},
            {
              get: () =>
                new Proxy(
                  {},
                  { get: () => ({ invalidate: mockInvalidate, refetch: vi.fn() }) }
                ),
            }
          );
      }
      // Router namespaces (e.g. trpc.reviews.getAll)
      return new Proxy(
        {},
        {
          get: () => ({
            useQuery: () => mockQueryResult,
            useMutation: () => mockMutationResult,
            useSuspenseQuery: () => ({ data: undefined }),
          }),
        }
      );
    },
  }
);

vi.mock("@/lib/trpc", () => ({ trpc: trpcRouterProxy }));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

// Silence import.meta.env warnings
if (!(globalThis as any).import_meta_env_set) {
  (globalThis as any).import_meta_env_set = true;
}

describe("Smoke Tests — Critical Page Renders", () => {
  it("Home page renders without crashing", async () => {
    const { default: Home } = await import("../pages/Home");
    const { container } = render(React.createElement(Home));
    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("BookingPage renders without crashing", async () => {
    const { default: BookingPage } = await import("../pages/BookingPage");
    const { container } = render(React.createElement(BookingPage));
    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("TireFinder renders without crashing", async () => {
    const { default: TireFinder } = await import("../pages/TireFinder");
    const { container } = render(React.createElement(TireFinder));
    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("GenericServicePage renders without crashing", async () => {
    // Replaces old ServicePage smoke (deleted 2026-04-24 in service-page
    // consolidation). GenericServicePage is the new long-tail wrapper.
    const { default: GenericServicePage } = await import("../pages/GenericServicePage");
    const { container } = render(React.createElement(GenericServicePage));
    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("Admin renders without crashing", async () => {
    const { default: Admin } = await import("../pages/Admin");
    const { container } = render(React.createElement(Admin));
    expect(container).toBeTruthy();
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("NonstopNickPage renders with the membership join card", async () => {
    // 2026-06-11 Nonstop Nick launch readiness — /nonstop-nick is a money
    // page (Stripe membership signup); pin that it renders AND that the
    // join card (plan picker + phone form) is present. Queries scoped to
    // this render's container — earlier page renders stay in the document.
    const { default: NonstopNickPage } = await import("../pages/NonstopNickPage");
    const { container } = render(React.createElement(NonstopNickPage));
    const q = within(container);
    expect(q.getAllByText(/Join Nonstop Nick/i).length).toBeGreaterThan(0);
    expect(q.getByLabelText(/your phone number/i)).toBeTruthy();
  });
});
