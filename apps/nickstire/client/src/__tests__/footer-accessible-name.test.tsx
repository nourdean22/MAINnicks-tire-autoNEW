/**
 * Footer trust strip — the Google-reviews link's accessible name must be its
 * visible label.
 *
 * WHY (2026-09-07, WCAG 2.2 SC 2.5.3 Label in Name): the link used to carry
 * aria-label="Read our Google reviews" while its visible text was
 * "4.9★ · 1,300+ Google reviews". A screen-reader user hears the label, a
 * voice-control user says what they SEE — and "click 4.9" found nothing,
 * because the accessible name no longer contained the visible text. The fix
 * removed the aria-label so the name is computed from content. This test
 * fails if someone re-adds a label that does not start with the visible text.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  useLocation: () => ["/", vi.fn()],
  useRoute: () => [true, {}],
  useParams: () => ({}),
  useSearch: () => "",
}));

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: () => new Proxy({}, {
      get: () => ({
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      }),
    }),
  }),
}));

describe("SiteFooter · Google reviews link", () => {
  it("has an accessible name computed from its visible text (no aria-label override)", async () => {
    const mod: any = await import("../components/SiteFooter");
    const SiteFooter = mod.default ?? mod.SiteFooter;
    expect(typeof SiteFooter, "SiteFooter export shape").toBe("function");
    render(React.createElement(SiteFooter));

    // `name` as a predicate receives the COMPUTED accessible name — aria-label
    // if present, otherwise the flattened text content. Both visible fragments
    // must be in it, in that order.
    const link = screen.getByRole("link", {
      name: (name) => name.includes("4.9★") && /Google reviews/i.test(name),
    });
    expect(link).toBeTruthy();
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.getAttribute("href")).toMatch(/google|g\.page|maps/i);
  });

  it("canary: a link whose aria-label hides its visible text is NOT matched by the same query", () => {
    render(
      React.createElement(
        "a",
        { href: "https://example.invalid", "aria-label": "Read our reviews" },
        "4.9★ · Google reviews",
      ),
    );
    expect(
      screen.queryByRole("link", {
        name: (name) => name.includes("4.9★") && /Google reviews/i.test(name) && name.startsWith("Read"),
      }),
    ).toBeNull();
    // and the label-hidden link's accessible name is the label, proving the
    // predicate reads the computed name rather than textContent.
    expect(screen.getByRole("link", { name: "Read our reviews" })).toBeTruthy();
  });
});
