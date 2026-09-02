/**
 * tests/components/brain/qualitative-identity-panel-error.test.tsx · 2026-09-02.
 *
 * A FAILED READ RENDERED A BLANK BODY, WHICH READS AS "NOTHING ON FILE".
 *
 * The panel gated its loader on `loading && !identity` (:145) and ALL of its
 * content on `identity &&` (:153), with no isError branch anywhere.
 * `loadQualitativeIdentity` (lib/brain/qualitative-identity.ts:303-318) has
 * no internal catch, so a DB failure propagates → `data` undefined →
 * `identity` null → NEITHER block renders. What survived was a header, a
 * recompute button, and a closing paragraph explaining what the (absent)
 * content means.
 *
 * The per-bucket "(empty — add one or let reflection auto-extract)" hint is
 * itself inside the gate, so the blank card was not merely uninformative —
 * it was indistinguishable from an identity with five empty buckets, which
 * is the state the panel's copy invites the operator to go and fix. Typing
 * values into a self-model that failed to load is exactly the wrong action.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PROVENANCE_LABEL } from "@/components/ui/empty-state";

interface QueryState {
  data?: { identity: unknown };
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
}

let queryState: QueryState = { isLoading: false, isError: false, error: null };

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({
      brain: { qualitativeIdentity: { invalidate: vi.fn() } },
    }),
    brain: {
      qualitativeIdentity: {
        useQuery: () => ({ ...queryState, dataUpdatedAt: Date.now() }),
      },
      recomputeQualitativeIdentity: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      editQualitativeIdentity: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";

const EMPTY_IDENTITY = {
  values: [],
  fears: [],
  operating_style: [],
  rhythms: [],
  red_lines: [],
  computed_at: "2026-09-02T00:00:00.000Z",
};

function render(state: QueryState): string {
  queryState = state;
  return renderToStaticMarkup(<QualitativeIdentityPanel />);
}

describe("QualitativeIdentityPanel · a failed read says so instead of rendering nothing", () => {
  it("declares ERROR provenance and surfaces the message", () => {
    const html = render({
      isLoading: false,
      isError: true,
      error: { message: "identity read failed" },
    });

    expect(html).toContain('data-provenance="ERROR"');
    expect(html).toContain(PROVENANCE_LABEL.ERROR);
    expect(html).toContain("identity read failed");
  });

  it("does NOT invite the operator to fill buckets it could not read", () => {
    const html = render({
      isLoading: false,
      isError: true,
      error: { message: "boom" },
    });

    // The hint that used to be indistinguishable from this state — because
    // it never rendered at all, and neither did anything else.
    expect(html).not.toContain("(empty — add one");
    expect(html).toContain("do not add entries");
  });

  it("is not mistakable for an identity whose five buckets are genuinely empty", () => {
    // THE DEFECT. Before this change these two renders differed only by the
    // bucket headings — and on a failed read those were gone too, so the
    // card was a header and a paragraph either way.
    const failed = render({
      isLoading: false,
      isError: true,
      error: { message: "boom" },
    });
    const measuredEmpty = render({
      data: { identity: EMPTY_IDENTITY },
      isLoading: false,
      isError: false,
      error: null,
    });

    expect(failed).not.toEqual(measuredEmpty);
    expect(measuredEmpty).toContain("(empty — add one");
    expect(measuredEmpty).not.toContain('data-provenance="ERROR"');
  });

  it("CONTROL · a loaded identity still renders every bucket", () => {
    // Without this, rendering the error state unconditionally would satisfy
    // every assertion above while deleting the panel.
    const html = render({
      data: {
        identity: {
          ...EMPTY_IDENTITY,
          values: [
            {
              text: "speed over politeness",
              manual: true,
              evidence_ids: [],
              confidence: 1,
              updated_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    expect(html).toContain("speed over politeness");
    expect(html).toContain("Values (1)");
    expect(html).toContain("Red lines (0)");
    expect(html).not.toContain(PROVENANCE_LABEL.ERROR);
  });

  it("a successful-but-empty envelope reads UNMEASURED, not ERROR", () => {
    const html = render({
      data: { identity: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    expect(html).toContain('data-provenance="UNMEASURED"');
    expect(html).not.toContain('data-provenance="ERROR"');
  });

  it("CONTROL · the loading state is still just a spinner", () => {
    const html = render({ isLoading: true, isError: false, error: null });

    expect(html).toContain("loading…");
    expect(html).not.toContain("data-provenance");
  });
});
