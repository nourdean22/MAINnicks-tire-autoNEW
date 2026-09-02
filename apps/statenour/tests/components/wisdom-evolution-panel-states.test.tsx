/**
 * The evolution panel never calls a corpus healthy on evidence it does
 * not have.
 *
 * THE DEFECT (2026-09-02 self-audit, #1). The panel read `evoQuery.data`
 * and `evoQuery.isLoading` and nothing else — grep for `isError`
 * returned nothing. A rejected query left `data` null, fell into the
 * `!data` branch, and printed "No candidates · the wisdom corpus is
 * healthy." The query rejects easily: `runWisdomEvolution` was a bare
 * `Promise.all` over three DB-backed finders.
 *
 * ASSERTED AS RENDERED MARKUP, not as source presence. An `isError`
 * branch that exists but renders the healthy copy would pass a
 * "contains isError" grep and fail every test below. The vitest env
 * here is Node with no DOM, so `renderToStaticMarkup` is how this repo
 * asserts on a component's output (see tests/components/wisdom-pill.test.tsx).
 *
 * The healthy state has its own test on purpose: without it, a panel
 * that ALWAYS said "state unknown" would pass the error cases and be
 * just as useless.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type QueryState = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
};

let queryState: QueryState = { data: undefined, isLoading: false, isError: false, error: null };

vi.mock("@/lib/trpc/client", () => {
  const mutationLeaf = {
    mutate: () => {},
    mutateAsync: async () => ({}),
    isPending: false,
  };
  return {
    trpc: {
      useUtils: () => ({ brain: { wisdomEvolution: { invalidate: async () => {} } } }),
      brain: {
        wisdomEvolution: { useQuery: () => queryState },
        actOnWisdom: { useMutation: () => mutationLeaf },
        recordTelemetry: { useMutation: () => mutationLeaf },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("lucide-react", () => ({ AlertCircle: () => null }));

import { WisdomEvolutionPanel } from "@/components/brain/wisdom-evolution-panel";

const HEALTHY = "the wisdom corpus is healthy";
const UNKNOWN = "state unknown, not empty";

function render(state: Partial<QueryState>): string {
  queryState = { data: undefined, isLoading: false, isError: false, error: null, ...state };
  return renderToStaticMarkup(<WisdomEvolutionPanel />);
}

const cleanReport = {
  stale: [],
  redundant: [],
  lowTrust: [],
  totalCandidates: 0,
  failures: [],
};

beforeEach(() => {
  queryState = { data: undefined, isLoading: false, isError: false, error: null };
});

describe("WisdomEvolutionPanel · honest states", () => {
  it("a FAILED query does not claim a healthy corpus", () => {
    const html = render({ isError: true, error: { message: "connection terminated" } });
    expect(html).not.toContain(HEALTHY);
    expect(html).toContain(UNKNOWN);
    expect(html).toContain("connection terminated");
  });

  it("a query with no data at all does not claim a healthy corpus", () => {
    // The literal pre-fix path: `data` null with no explicit error flag.
    const html = render({ data: undefined });
    expect(html).not.toContain(HEALTHY);
    expect(html).toContain(UNKNOWN);
  });

  it("zero candidates WITH a failed finder reads as unknown, not healthy", () => {
    const html = render({
      data: {
        ...cleanReport,
        failures: [{ finder: "redundant", message: "connection terminated" }],
      },
    });
    expect(html).not.toContain(HEALTHY);
    expect(html).toContain("redundant");
    expect(html).toContain("could not run");
  });

  it("partial results are rendered AND labelled partial", () => {
    const html = render({
      data: {
        stale: [
          {
            type: "stale",
            id: "s1",
            key: "wisdom_stale_1",
            content: "an old principle",
            confidence: 0.4,
            daysSinceLastSeen: 90,
            reason: "cold",
          },
        ],
        redundant: [],
        lowTrust: [],
        totalCandidates: 1,
        failures: [{ finder: "lowTrust", message: "timeout" }],
      },
    });
    expect(html).toContain("an old principle");
    expect(html).toContain("low trust");
    expect(html).toContain("timeout");
    expect(html).toContain("could not run");
  });

  it("zero candidates and NO failures still reads as healthy", () => {
    // The control. A panel hard-wired to "state unknown" would pass
    // every test above and tell the operator nothing.
    const html = render({ data: cleanReport });
    expect(html).toContain(HEALTHY);
    expect(html).not.toContain(UNKNOWN);
  });

  it("loading is neither healthy nor unknown", () => {
    const html = render({ isLoading: true });
    expect(html).toContain("loading evolution candidates");
    expect(html).not.toContain(HEALTHY);
  });
});
