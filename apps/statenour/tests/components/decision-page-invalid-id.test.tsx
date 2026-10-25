/**
 * /decisions/[id] with an id that is not a positive integer - honest-reads leftovers 2026-10-25.
 *
 * The page disables its query on an invalid id (`enabled: idValid`). A disabled react-query v5 query
 * has no data, no error, isLoading false and isPending true, which lib/query-state.ts reads as
 * "loading". Every branch then missed it and the page fell through to `if (!data) return null`: a
 * blank page where "not found" belongs. Handled at the page, before the query branches, so
 * readState itself is unchanged. Each failure case pairs with a CONTROL: a valid id still loads,
 * says offline, and says failed exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ id: "7", detail: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/decisions/x",
}));
vi.mock("@/lib/trpc/client", () => {
  const mutation = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false };
  return {
    trpc: {
      operator: {
        decisionDetail: { useQuery: () => h.detail },
        gradeDecision: { useMutation: () => mutation },
      },
    },
  };
});
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: () => {}, onDataChanged: () => () => {} }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import DecisionDetailPage from "@/app/(mastery)/decisions/[id]/page";

const base = {
  data: undefined,
  error: null,
  isError: false,
  isLoading: false,
  isPending: false,
  isFetching: false,
  fetchStatus: "idle",
  dataUpdatedAt: 0,
  refetch: () => Promise.resolve(),
};
/** What react-query v5 returns for `enabled: false` with nothing cached. */
const DISABLED = { ...base, isPending: true };

beforeEach(() => {
  h.id = "7";
  h.detail = {};
});

describe("/decisions/[id]: an invalid id is not found, not a blank page", () => {
  for (const bad of ["abc", "0", "-3", "1.5"]) {
    it(`id "${bad}" renders a not-found message`, () => {
      h.id = bad;
      h.detail = DISABLED;
      const html = renderToStaticMarkup(<DecisionDetailPage />);
      expect(html, "blank page on an invalid id").not.toBe("");
      expect(html).toContain("Decision not found");
      expect(html).not.toContain("Loading decision");
    });
  }

  it("CONTROL: a valid id still loads", () => {
    h.detail = { ...base, isPending: true, isLoading: true, isFetching: true, fetchStatus: "fetching" };
    const html = renderToStaticMarkup(<DecisionDetailPage />);
    expect(html).toContain("Loading decision evidence");
    expect(html).not.toContain("Decision not found");
  });

  it("CONTROL: a valid id with a paused read still says offline", () => {
    h.detail = { ...base, isPending: true, fetchStatus: "paused" };
    const html = renderToStaticMarkup(<DecisionDetailPage />);
    expect(html).toContain("Offline.");
    expect(html).not.toContain("Decision not found");
  });

  it("CONTROL: a valid id with a failed read still says load failed", () => {
    h.detail = { ...base, isError: true, error: { message: "boom" } };
    const html = renderToStaticMarkup(<DecisionDetailPage />);
    expect(html).toContain("load failed");
    expect(html).not.toContain("Decision not found");
  });
});
