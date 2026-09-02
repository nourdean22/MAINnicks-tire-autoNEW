/**
 * CANARY · the Discover empty state named TWO causes when there are FOUR.
 *
 * The copy asserted, unconditionally: "the queue is genuinely empty… every
 * recent discovery already has a verdict, or the engines found nothing this
 * cycle. Both are real zeros here." But `items` is also empty when every
 * remaining unrated row was WITHHELD — as a restored row (the 2026-08-16
 * rescue pile, 237 rows on prod) or as a judged twin (the 2026-08-28
 * suppression). Those two are counted and disclosed by the toggle blocks
 * directly above, so the surface could simultaneously say "237 hidden" and
 * "both are real zeros here".
 *
 * When something is withheld this is not a measured zero at all; it is
 * EmptyState's SUPPRESSED — "hidden by design" — and its type carries that
 * distinction for exactly this reason (see
 * tests/components/empty-state-provenance.test.tsx).
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("lucide-react", () => ({
  Lightbulb: () => null,
  Sparkles: () => null,
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ brain: { discoveries: { invalidate: vi.fn() } } }),
    brain: {
      discoveries: { useQuery: () => ({ isLoading: false, isError: false, data: undefined }) },
      rateDiscoveryCluster: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

import { discoverEmptyState, SEVERITY_WORD } from "@/components/brain/discover-tab";
import { EmptyState, PROVENANCE_LABEL } from "@/components/ui/empty-state";

const render = (s: ReturnType<typeof discoverEmptyState>) =>
  s.provenance === "SUPPRESSED"
    ? renderToStaticMarkup(<EmptyState title={s.title} provenance="SUPPRESSED" />)
    : renderToStaticMarkup(
        <EmptyState title={s.title} provenance="ZERO" why={s.why} unlock={s.unlock} />,
      );

describe("CANARY · an empty CARD LIST is not automatically an empty QUEUE", () => {
  it("BREAKS: withheld restored rows are not reported as a real zero", () => {
    const s = discoverEmptyState({ restoredHidden: 237, suppressedSimilar: 0, truncated: false });

    expect(s.provenance).toBe("SUPPRESSED");
    const html = render(s);
    expect(html).toContain(PROVENANCE_LABEL.SUPPRESSED);
    expect(html).not.toContain(PROVENANCE_LABEL.ZERO);
    expect(html).not.toMatch(/real zeros/);
    expect(html).toMatch(/237 unrated rows withheld/);
  });

  it("BREAKS: withheld judged twins are not reported as a real zero either", () => {
    const s = discoverEmptyState({ restoredHidden: 0, suppressedSimilar: 5, truncated: false });
    expect(s.provenance).toBe("SUPPRESSED");
    expect(render(s)).not.toMatch(/real zeros/);
  });

  it("positive control: a true zero still makes the all-clear claim, and names its two causes", () => {
    const s = discoverEmptyState({ restoredHidden: 0, suppressedSimilar: 0, truncated: false });

    expect(s.provenance).toBe("ZERO");
    const html = render(s);
    expect(html).toContain(PROVENANCE_LABEL.ZERO);
    expect(html).toMatch(/already has a verdict/);
    expect(html).toMatch(/found nothing this cycle/);
    // The claim is now conditional on nothing being withheld, and says so.
    expect(html).toMatch(/nothing is being withheld/);
  });

  it("the floor marker follows the count that is actually bounded", () => {
    // restoredHidden is its own exact scoped SQL count; only suppressedSimilar
    // is bounded by the card scan. Appending "+" to a pile made purely of
    // restored rows would repeat the "presented an exact 237 as a lower bound"
    // defect this file's sibling block already fixed once.
    expect(
      discoverEmptyState({ restoredHidden: 237, suppressedSimilar: 0, truncated: true }).title,
    ).toMatch(/237 unrated rows/);
    expect(
      discoverEmptyState({ restoredHidden: 237, suppressedSimilar: 0, truncated: true }).title,
    ).not.toMatch(/237\+/);
    expect(
      discoverEmptyState({ restoredHidden: 2, suppressedSimilar: 3, truncated: true }).title,
    ).toMatch(/5\+ unrated rows/);
    expect(
      discoverEmptyState({ restoredHidden: 0, suppressedSimilar: 1, truncated: false }).title,
    ).toMatch(/1 unrated row withheld/);
  });
});

describe("CANARY · the resurface banner can render a severity WORD, never `undefined`", () => {
  it("BREAKS: every rank the recurrence policy can write indexes SEVERITY_WORD", async () => {
    // The banner reads SEVERITY_WORD[history[last].severityRank]. The only
    // producer of that field is persistBlindSpot, and the only ranks it can
    // write are SEVERITY_RANK's values — shouldResurface refuses a null rank
    // rather than defaulting one, which is what keeps this total.
    const { SEVERITY_RANK } = await import("@/lib/brain/blind-spot-identity");
    for (const rank of Object.values(SEVERITY_RANK)) {
      expect(SEVERITY_WORD[rank]).toBeTypeOf("string");
    }
    expect(SEVERITY_WORD).toHaveLength(Object.keys(SEVERITY_RANK).length);
  });
});
