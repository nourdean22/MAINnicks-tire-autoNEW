/**
 * Tire Finder Tests — Verify tire data and module integrity
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
    useMutation: (opts: any) => ({
      mutate: (vars: any) => {
        console.log("MOCK MUTATE CALLED FOR KEY:", key, "HAS ON_SUCCESS:", !!opts?.onSuccess);
        if (key === "gatewayTire.placeOrder" && opts?.onSuccess) {
          opts.onSuccess({
            success: true,
            orderNumber: "TO-20260623-854",
            invoiceNumber: "INV-20260623-003",
            totalAmount: 0,
          });
        }
      },
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

    // Verify default pricing is displayed correctly as pending confirmation
    expect(screen.getByText("Price Pending Confirmation")).toBeTruthy();

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

describe("Ezytire Environment Variables", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("renders size-only search and hides tabs when VITE_EZYTIRE_BASE_URL is missing", async () => {
    vi.stubEnv("VITE_EZYTIRE_BASE_URL", "");
    vi.stubEnv("PROD", true as any);

    const { default: TireFinder } = await import("@/pages/TireFinder");
    render(React.createElement(TireFinder));

    // The tab switcher shouldn't render, and the vehicle tab shouldn't exist
    expect(screen.queryByText("Search by Vehicle")).toBeNull();
    expect(screen.queryByText("Get Fitment Help")).toBeNull();
    // The standard size search input should be visible
    expect(screen.getByPlaceholderText("Enter tire size (e.g. 215/60R16)")).toBeTruthy();
  });

  it("renders all tabs when VITE_EZYTIRE_BASE_URL is present", async () => {
    vi.stubEnv("VITE_EZYTIRE_BASE_URL", "test.ezytiredemo.com");
    vi.stubEnv("PROD", true as any);

    const { default: TireFinder } = await import("@/pages/TireFinder");
    render(React.createElement(TireFinder));

    // The tab switcher should render all tabs
    expect(screen.getByText("Search by Size")).toBeTruthy();
    expect(screen.getByText("Search by Vehicle")).toBeTruthy();
    expect(screen.getByText("Get Fitment Help")).toBeTruthy();
  });

  it("OrderModal handles tire with $0 price properly for custom quote requests", async () => {
    const { OrderModal } = await import("@/pages/TireFinder");
    const onClose = vi.fn();
    
    render(
      React.createElement(OrderModal, {
        tire: {
          name: "Mock Tire",
          brand: "MockBrand",
          model: "MockModel",
          size: "205/55R16",
          shopPrice: 0,
          pricePerTireCents: 0,
        },
        quantity: 4,
        packageValue: 289,
        onClose,
      })
    );

    // Verify default pricing is displayed correctly as pending confirmation
    expect(screen.getAllByText("Price Pending Confirmation").length).toBeGreaterThan(0);

    // Let's submit the form to transition to the success screen
    fireEvent.change(screen.getByPlaceholderText("John Smith"), { target: { value: "Nour Test" } });
    fireEvent.change(screen.getByPlaceholderText("(216) 555-0000"), { target: { value: "(216) 555-9999" } });
    fireEvent.change(screen.getByPlaceholderText("2020"), { target: { value: "2022" } });
    fireEvent.change(screen.getByPlaceholderText("Honda"), { target: { value: "Honda" } });
    fireEvent.change(screen.getByPlaceholderText("Civic"), { target: { value: "Accord" } });

    const submitBtn = screen.getByRole("button", { name: /Request Price Confirmation/i });

    // Now click the submit button
    const { act } = await import("@testing-library/react");
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify that the success state renders 'Price Pending Confirmation' and shows payment pending text
    expect(screen.getAllByText("Price Pending Confirmation").length).toBeGreaterThan(0);
    expect(screen.getByText("Online payment will be available once staff confirms pricing.")).toBeTruthy();
    expect(screen.queryByText(/Pay Now/)).toBeNull();
    expect(screen.queryByText("Snap Finance")).toBeNull();
    expect(screen.queryByText("Acima Credit")).toBeNull();
  });
});
