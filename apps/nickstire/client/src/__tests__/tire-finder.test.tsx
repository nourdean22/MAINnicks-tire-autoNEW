/**
 * Tire Finder Tests — Verify tire data and module integrity
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Mock wouter and framer-motion like in admin.test.tsx
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => ["/tires", vi.fn()],
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

vi.mock("@/lib/trpc", () => {
  const queryResult = (key: string) => {
    if (key === "gatewayTire.getPackage") {
      return { data: { packageValuePerSet: 289, services: [] }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  };
  const procedure = (key: string) => ({
    useQuery: () => queryResult(key),
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  });
  const utils = () => ({});
  const trpc = new Proxy({}, {
    get: (_t, ns) => {
      if (ns === "useUtils" || ns === "useContext") return utils;
      return new Proxy({}, { get: (_t2, proc) => procedure(`${String(ns)}.${String(proc)}`) });
    },
  });
  return { trpc };
});

describe("Tire Finder Module", () => {
  afterEach(cleanup);

  it("exports a default component", async () => {
    const mod = await import("@/pages/TireFinder");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("OrderModal handles null tire properly for custom quote requests", async () => {
    const { OrderModal } = await import("@/pages/TireFinder");
    const onClose = vi.fn();
    
    render(
      React.createElement(OrderModal, {
        tire: null,
        quantity: 4,
        packageValue: 289,
        onClose,
        prefilledVehicle: {
          year: "2021",
          make: "Toyota",
          model: "RAV4",
          option: "LE",
          speeds: "H",
        }
      })
    );

    // Verify default pricing is displayed correctly
    // Total price is: $89.00 * 4 = $356.00
    // Tax is: Math.round($356.00 * 0.08) = $28.48
    // Card processing is: Math.round(($356.00 + $28.48) * 0.02) = $7.69
    // Total: $356.00 + $28.48 + $7.69 = $392.17
    expect(screen.getByText("$392.17")).toBeTruthy();

    // Verify prefilled vehicle is populated
    const yearInput = screen.getByPlaceholderText("2020") as HTMLInputElement;
    expect(yearInput.value).toBe("2021");

    const makeInput = screen.getByPlaceholderText("Honda") as HTMLInputElement;
    expect(makeInput.value).toBe("Toyota");

    const modelInput = screen.getByPlaceholderText("Civic") as HTMLInputElement;
    expect(modelInput.value).toBe("RAV4");

    const optionInput = screen.getByPlaceholderText("LX / EX") as HTMLInputElement;
    expect(optionInput.value).toBe("LE");
  });
});

describe("Tire Data Integrity", () => {
  it("tire size pages have valid data", async () => {
    const { TIRE_SIZE_PAGES } = await import("@shared/tireSizes");
    expect(Array.isArray(TIRE_SIZE_PAGES)).toBe(true);
    expect(TIRE_SIZE_PAGES.length).toBeGreaterThan(0);

    for (const page of TIRE_SIZE_PAGES) {
      expect(page.size).toBeTruthy();
      expect(page.slug).toBeTruthy();
      expect(page.slug).toMatch(/^[a-z0-9-]+$/); // URL-safe
    }
  });

  it("no duplicate tire size slugs", async () => {
    const { TIRE_SIZE_PAGES } = await import("@shared/tireSizes");
    const slugs = TIRE_SIZE_PAGES.map((p: { slug: string }) => p.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });
});

describe("Financing Options", () => {
  it("financing providers are defined", async () => {
    const { FINANCING_PROVIDERS } = await import("@shared/financing");
    expect(Array.isArray(FINANCING_PROVIDERS)).toBe(true);
    expect(FINANCING_PROVIDERS.length).toBeGreaterThan(0);

    for (const provider of FINANCING_PROVIDERS) {
      expect(provider.name).toBeTruthy();
    }
  });
});
