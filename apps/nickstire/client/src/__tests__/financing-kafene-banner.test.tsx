/**
 * /financing: the Kafene card (first provider) carries Kafene's 300x250 banner,
 * linked to the applyUrl from shared/financing, lazy-loaded with fixed dimensions.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

const h = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/lib/trpc", () => {
  const proc = () => ({
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
    useMutation: () => ({ mutate: (...a: unknown[]) => h.mutate(...a), isPending: false }),
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
  afterEach(() => {
    cleanup();
    h.mutate.mockReset();
    vi.restoreAllMocks();
  });

  async function kafeneLink() {
    const { default: Financing } = await import("@/pages/Financing");
    render(React.createElement(Financing));
    return screen.getByAltText(/^Kafene:/).closest("a")!;
  }

  it("a Kafene click tracks provider 'kafene' fire-and-forget: a rejection is swallowed with a debug log", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const link = await kafeneLink();
    expect(fireEvent.click(link)).toBe(true); // default not prevented: the link opens
    expect(h.mutate).toHaveBeenCalledTimes(1);
    const [vars, opts] = h.mutate.mock.calls[0] as [{ provider: string }, { onError?: (e: unknown) => void } | undefined];
    expect(vars.provider).toBe("kafene");
    // The server may reject "kafene" until its migration lands; that must stay quiet.
    expect(() => opts?.onError?.(new Error("BAD_REQUEST"))).not.toThrow();
    expect(opts?.onError).toBeTypeOf("function");
    expect(debug).toHaveBeenCalled();
  });

  it("a tracking call that throws on the spot still never blocks the link", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    h.mutate.mockImplementation(() => { throw new Error("client not ready"); });
    const link = await kafeneLink();
    // React reports a click-handler error to window "error" rather than throwing it here.
    const reported: unknown[] = [];
    const onError = (e: ErrorEvent) => { reported.push(e.error); e.preventDefault(); };
    window.addEventListener("error", onError);
    let opened = false;
    try {
      opened = fireEvent.click(link);
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(reported).toEqual([]);
    expect(opened).toBe(true);
  });

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
