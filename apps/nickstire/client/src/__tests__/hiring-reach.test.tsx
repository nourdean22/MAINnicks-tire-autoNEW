/**
 * Hiring reach (job 2026-10-30-tech-hiring-page, W2 + W3).
 *
 * W2: every page's footer carries one hiring line linking to /careers, with
 *     the auto-tech pay band read from shared/jobOpenings.ts (never typed).
 * W3: the owner's open-interview hours (Mondays 11 AM to 2 PM, walk in with an
 *     ID, a few minutes with the manager) show on /careers, on each job page,
 *     and inside each JobPosting description, which Google requires to match
 *     the visible page.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  useLocation: () => ["/", vi.fn()],
  useRoute: () => [true, { slug: "automotive-technician" }],
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

const INTERVIEW = /Open interviews every Monday, 11 AM to 2 PM/;

describe("W2 · footer hiring line", () => {
  it("links to /careers with the published auto-tech band", async () => {
    const { JOB_OPENINGS, formatHourlyPayRange } = await import("@shared/jobOpenings");
    const band = formatHourlyPayRange(JOB_OPENINGS.find((j) => j.slug === "automotive-technician")!)!;
    const mod: any = await import("../components/SiteFooter");
    const SiteFooter = mod.default ?? mod.SiteFooter;
    render(React.createElement(SiteFooter));
    const link = screen.getByRole("link", { name: /hiring technicians/i });
    expect(link.getAttribute("href")).toBe("/careers");
    expect(link.textContent).toContain(band);
  });
});

describe("W3 · open interviews", () => {
  it("every open JobPosting description carries the interview line", async () => {
    const { openJobOpenings, buildJobPostingSchema } = await import("@shared/jobOpenings");
    for (const j of openJobOpenings()) {
      const schema = buildJobPostingSchema(j, {
        siteUrl: "https://nickstire.org",
        orgName: "Nick's Tire & Auto",
        logoUrl: "https://nickstire.org/icon-512x512.png",
        shopHours: "Mon-Sat 8-6",
        address: { street: "1 Main", city: "Cleveland", state: "OH", zip: "44112" },
      })!;
      expect(String(schema.description)).toMatch(INTERVIEW);
    }
  });

  it("the job page shows the same line", async () => {
    const mod: any = await import("../pages/JobPage");
    render(React.createElement(mod.default));
    expect(screen.getAllByText(INTERVIEW).length).toBeGreaterThan(0);
  });
});
