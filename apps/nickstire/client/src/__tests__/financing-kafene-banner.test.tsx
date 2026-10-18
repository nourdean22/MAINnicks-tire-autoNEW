/**
 * /financing: the Kafene card (first provider) carries Kafene's 300x250 banner,
 * linked to the applyUrl from shared/financing, lazy-loaded with fixed dimensions.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/financing", vi.fn()],
  useSearch: () => "",
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
}));

vi.mock("@/lib/trpc", () => {
  const proc = () => ({
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => ({}) : new Proxy({}, { get: () => proc() }),
  });
  return { trpc };
});

vi.mock("@/components/SEO", () => ({
  SEOHead: () => null,
  Breadcrumbs: () => null,
  trackEvent: vi.fn(),
  trackPhoneClick: vi.fn(),
}));

describe("Financing page · Kafene banner", () => {
  afterEach(cleanup);

  it("the Kafene card shows the 300x250 banner linked to Kafene's applyUrl", async () => {
    const { FINANCING_PROVIDERS } = await import("@shared/financing");
    const kafene = FINANCING_PROVIDERS.find((p) => p.id === "kafene")!;
    const { default: Financing } = await import("@/pages/Financing");
    render(React.createElement(Financing));
    const img = screen.getByAltText("Kafene: get up to $5,000 today, low lease payments and no credit needed. Apply now.") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/kafene/kafene-300x250.png");
    expect(img.getAttribute("width")).toBe("300");
    expect(img.getAttribute("height")).toBe("250");
    expect(img.getAttribute("loading")).toBe("lazy");
    const link = img.closest("a")!;
    expect(link.getAttribute("href")).toBe(kafene.applyUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
