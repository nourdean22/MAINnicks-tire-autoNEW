/**
 * Hero personalization (feat/home-v2 Wave C) — pure derivation rules +
 * the Home render integration (brakes campaign swaps the primary lane,
 * tires never disappears, Maps referrer shows the proximity note).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { deriveHeroPersonalization } from "@/lib/heroPersonalization";

// ─── Pure rules ──────────────────────────────────────────────────
describe("deriveHeroPersonalization — rules", () => {
  it("defaults to tires lead with no signals", () => {
    expect(deriveHeroPersonalization({})).toEqual({ leadIntent: "tires", showProximityNote: false });
  });

  it("brake campaign → brakes lead", () => {
    expect(deriveHeroPersonalization({ utmCampaign: "summer-BRAKE-special" }).leadIntent).toBe("brakes");
    expect(deriveHeroPersonalization({ utmTerm: "brake repair near me" }).leadIntent).toBe("brakes");
  });

  it("explicit tire signal wins over an incidental brake mention", () => {
    expect(deriveHeroPersonalization({ utmCampaign: "tires-and-brakes-promo" }).leadIntent).toBe("tires");
  });

  it("Google Maps referrers set the proximity note; plain Google search does not", () => {
    expect(deriveHeroPersonalization({ referrer: "https://maps.app.goo.gl/abc" }).showProximityNote).toBe(true);
    expect(deriveHeroPersonalization({ referrer: "https://maps.google.com/xyz" }).showProximityNote).toBe(true);
    expect(deriveHeroPersonalization({ referrer: "https://www.google.com/maps/place/nicks" }).showProximityNote).toBe(true);
    expect(deriveHeroPersonalization({ referrer: "https://www.google.com/search?q=tires" }).showProximityNote).toBe(false);
    expect(deriveHeroPersonalization({ referrer: "not a url" }).showProximityNote).toBe(false);
  });
});

// ─── Home integration ────────────────────────────────────────────
const h = vi.hoisted(() => ({
  utm: {} as Record<string, unknown>,
}));

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
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) })
      : new Proxy({}, { get: () => ({
          useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }) }),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));
vi.mock("@/lib/utm", () => ({
  getUtmData: () => h.utm,
  captureUtmParams: vi.fn(),
}));

async function renderHome() {
  const { default: Home } = await import("../pages/Home");
  return render(React.createElement(Home));
}

describe("HomeV2 hero — personalization integration", () => {
  afterEach(() => { cleanup(); h.utm = {}; });

  it("default traffic: tires primary + diagnose secondary, no proximity note", async () => {
    h.utm = {};
    await renderHome();
    expect(screen.getByText("Get tires now")).toBeTruthy();
    expect(screen.getByText("Something's wrong")).toBeTruthy();
    expect(screen.queryByText("Brake check today")).toBeNull();
    expect(screen.queryByTestId("proximity-note")).toBeNull();
  });

  it("brake campaign: brakes primary, tires stays as a secondary lane", async () => {
    h.utm = { utmCampaign: "cleveland-brake-repair" };
    await renderHome();
    expect(screen.getByText("Brake check today")).toBeTruthy();
    expect(screen.getByText("Need tires too?")).toBeTruthy(); // tires never disappears
    expect(screen.queryByText("Get tires now")).toBeNull();
  });

  it("Maps referrer: proximity note renders", async () => {
    h.utm = { referrer: "https://maps.app.goo.gl/xyz" };
    await renderHome();
    expect(screen.getByTestId("proximity-note")).toBeTruthy();
  });
});
