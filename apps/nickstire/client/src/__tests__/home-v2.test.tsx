/**
 * HomeV2 doctrine lock — the homepage must stay subtracted + compliant.
 *
 * The 2026-07-12 verified audit found the old homepage live-rendering all
 * four patterns the /tires doctrine killed (financing pressure, fabricated
 * fear stats, competitor anchor tables, 4x-repeated trust) plus a hero
 * with 4 competing CTAs. These tests pin the rebuild: the four killed
 * patterns must NOT come back, the 4-path intent router must exist, and
 * the $25 price floor must always travel with its typical band
 * (shared/business.ts usedTires rule).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => window.location.search,
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

async function renderHome() {
  const { default: Home } = await import("../pages/Home");
  return render(React.createElement(Home));
}

describe("HomeV2 — subtract + comply doctrine lock", () => {
  afterEach(cleanup);

  it("renders the hero with the 4-path intent router (one primary lane)", async () => {
    await renderHome();
    expect(screen.getByText("Get tires now")).toBeTruthy();          // primary lane → /tires
    expect(screen.getByText("Something's wrong")).toBeTruthy();      // → /diagnose
    expect(screen.getByText("Dropping off")).toBeTruthy();           // → #dropoff
    expect(screen.getByText("Talk to a human")).toBeTruthy();        // → tel:
  });

  it("hero router lanes point at the real completing paths", async () => {
    const { container } = await renderHome();
    expect(container.querySelector('a[href="/tires"]')).toBeTruthy();
    expect(container.querySelector('a[href="/diagnose"]')).toBeTruthy();
    expect(container.querySelector('a[href="#dropoff"]')).toBeTruthy();
    // The #dropoff anchor target must exist on the page.
    expect(container.querySelector("#dropoff")).toBeTruthy();
  });

  it("the four killed patterns do NOT render", async () => {
    await renderHome();
    // Financing pressure (LossOpportunitySection / FinancingCTA banner)
    expect(screen.queryByText(/Every day your car gets sicker/i)).toBeNull();
    expect(screen.queryByText(/SEE PAYMENT PROGRAMS/i)).toBeNull();
    expect(screen.queryByText(/four payment programs compete/i)).toBeNull();
    // Fabricated fear stats (SafetyFactsSection / LossAversionStat)
    expect(screen.queryByText(/What waiting actually costs/i)).toBeNull();
    expect(screen.queryByText(/\$3,800/)).toBeNull();
    // Competitor anchor tables (PriceCompareSection / ComparisonTable)
    expect(screen.queryByText(/Same job\. A fraction of the price\./i)).toBeNull();
    expect(screen.queryByText(/national-chain quotes vs\. ours/i)).toBeNull();
  });

  it("fear-stat numbers stay out of the triage copy (softened to mechanical truths)", async () => {
    await renderHome();
    expect(screen.queryByText(/\$4,000 catalytic converter/i)).toBeNull();
    expect(screen.queryByText(/criminal charges/i)).toBeNull();
    expect(screen.queryByText(/Stopping distance doubles/i)).toBeNull();
  });

  it("the $25 floor always travels with its typical band", async () => {
    await renderHome();
    // Subhead + hero trust chip both carry the band.
    expect(screen.getAllByText(/most sizes \$40-80/i).length).toBeGreaterThanOrEqual(2);
  });

  it("trust renders once inline (hero chip) + one full unit (Reviews) — no TrustNumbers strip", async () => {
    await renderHome();
    expect(screen.getByText(/five.?star reviews\./i)).toBeTruthy(); // Reviews heading
    // TrustNumbers strip's distinctive stat VALUES must be gone. (The
    // footer's "Payment Programs" nav link is navigation, not the strip.)
    expect(screen.queryByText("ON-SPOT")).toBeNull();
    expect(screen.queryByText(/Walk-Ins · Open Sunday/i)).toBeNull();
  });
});
