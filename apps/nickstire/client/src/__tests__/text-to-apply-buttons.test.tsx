/**
 * Text-to-apply buttons (job 2026-10-30-tech-hiring-page, W1): every open job
 * page and the /careers hero render an sms: link to the shop line from
 * BUSINESS.phone.raw, whose body decodes to the exact prefill the server routes
 * on, and the hero button keeps a 44 px tap target.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const route = vi.hoisted(() => ({ slug: "automotive-technician" }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  useLocation: () => ["/careers", vi.fn()],
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

const bodyOf = (href: string) => decodeURIComponent(href.split("?&body=")[1] ?? "");

beforeEach(() => cleanup());

describe("text-to-apply buttons", () => {
  it("each open job page links to the shop line with that role prefilled", async () => {
    const { BUSINESS } = await import("@shared/business");
    const { openJobOpenings } = await import("@shared/jobOpenings");
    const { default: JobPage } = await import("../pages/JobPage");
    for (const j of openJobOpenings()) {
      cleanup();
      route.slug = j.slug;
      render(React.createElement(JobPage));
      const href = screen.getByRole("link", { name: /text us to apply/i }).getAttribute("href") ?? "";
      expect(href.startsWith(`sms:${BUSINESS.phone.raw}?&body=`)).toBe(true);
      expect(bodyOf(href)).toBe(`JOB-APPLY ${j.title}. My name is `);
    }
  });

  it("the /careers hero links to the shop line with no role and a 44 px tap target", async () => {
    const { BUSINESS } = await import("@shared/business");
    const { default: Careers } = await import("../pages/Careers");
    render(React.createElement(Careers));
    const link = screen.getByRole("link", { name: /text us to apply/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith(`sms:${BUSINESS.phone.raw}?&body=`)).toBe(true);
    expect(bodyOf(href)).toBe("JOB-APPLY My name is ");
    expect(link.className).toContain("min-h-[44px]");
  });
});
