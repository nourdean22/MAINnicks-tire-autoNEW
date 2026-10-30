/**
 * Hiring reach (job 2026-10-30-tech-hiring-page, W2 + W3).
 *
 * W2: every page's footer carries one hiring line linking to /careers, with
 *     the auto-tech pay band read from shared/jobOpenings.ts (never typed), and
 *     no line at all when that role closes or has no band.
 * W3: the owner's open-interview hours (Mondays 11 AM to 2 PM, walk in with an
 *     ID, a few minutes with the manager) show on /careers, on each job page,
 *     and inside each JobPosting description, which Google requires to match
 *     the visible page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const route = vi.hoisted(() => ({ slug: "automotive-technician" }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  useLocation: () => ["/", vi.fn()],
  useRoute: () => [true, { slug: route.slug }],
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

const INTERVIEW =
  "Open interviews Mondays, 11 AM to 2 PM. Walk in with an ID and talk with the manager for a few minutes.";

beforeEach(() => cleanup());

describe("W2 · footer hiring line", () => {
  afterEach(() => {
    vi.doUnmock("@shared/jobOpenings");
    vi.resetModules();
  });

  /** Render SiteFooter against a jobOpenings module whose auto-tech role is patched. */
  async function renderFooterWith(patch: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("@shared/jobOpenings", async () => {
      const real = await vi.importActual<typeof import("@shared/jobOpenings")>("@shared/jobOpenings");
      const jobs = real.JOB_OPENINGS.map((j) => (j.slug === "automotive-technician" ? { ...j, ...patch } : j));
      return { ...real, JOB_OPENINGS: jobs, jobOpeningBySlug: (s: string) => jobs.find((j) => j.slug === s) };
    });
    const mod: any = await import("../components/SiteFooter");
    render(React.createElement(mod.default ?? mod.SiteFooter));
  }

  it("links to /careers, names automotive technicians, and shows the live band once", async () => {
    await renderFooterWith({});
    const link = screen.getByRole("link", { name: /hiring automotive technicians/i });
    expect(link.getAttribute("href")).toBe("/careers");
    expect(link.textContent).toBe(
      "Hiring automotive technicians: $30.00–$37.50/hr. Open interviews Mondays, 11 AM to 2 PM.",
    );
  });

  it("the band follows the data, not a copy of it", async () => {
    await renderFooterWith({ salaryMinHourlyCents: 3100, salaryMaxHourlyCents: 3800 });
    expect(screen.getByRole("link", { name: /hiring automotive technicians/i }).textContent).toContain("$31.00–$38.00/hr.");
  });

  it("no line when the role is closed", async () => {
    await renderFooterWith({ status: "closed" });
    expect(screen.queryByRole("link", { name: /hiring/i })).toBeNull();
  });

  it("no line when the role has no published band", async () => {
    await renderFooterWith({ salaryMinHourlyCents: null, salaryMaxHourlyCents: null });
    expect(screen.queryByRole("link", { name: /hiring/i })).toBeNull();
  });
});

describe("W3 · open interviews", () => {
  it("every open JobPosting description carries the interview line", async () => {
    const { openJobOpenings, buildJobPostingSchema } = await import("@shared/jobOpenings");
    expect(openJobOpenings().length).toBeGreaterThan(0);
    for (const j of openJobOpenings()) {
      const schema = buildJobPostingSchema(j, {
        siteUrl: "https://nickstire.org",
        orgName: "Nick's Tire & Auto",
        logoUrl: "https://nickstire.org/icon-512x512.png",
        shopHours: "Mon-Sat 8-6",
        address: { street: "1 Main", city: "Cleveland", state: "OH", zip: "44112" },
      })!;
      expect(String(schema.description)).toContain(INTERVIEW);
    }
  });

  it("each job page shows the line and its ld+json JobPosting carries the same text", async () => {
    const { openJobOpenings } = await import("@shared/jobOpenings");
    const { default: JobPage } = await import("../pages/JobPage");
    expect(openJobOpenings().length).toBeGreaterThan(0);
    for (const j of openJobOpenings()) {
      cleanup();
      route.slug = j.slug;
      const { container } = render(React.createElement(JobPage));
      expect(screen.getAllByText(INTERVIEW).length).toBeGreaterThan(0);
      const posting = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
        .map((s) => JSON.parse(s.textContent ?? "{}"))
        .find((d) => d["@type"] === "JobPosting");
      expect(posting, `JobPosting on ${j.slug}`).toBeTruthy();
      expect(String(posting.description)).toContain(INTERVIEW);
    }
  });

  it("the /careers page shows the line", async () => {
    const { default: Careers } = await import("../pages/Careers");
    render(React.createElement(Careers));
    expect(screen.getAllByText(INTERVIEW).length).toBeGreaterThan(0);
  });
});
