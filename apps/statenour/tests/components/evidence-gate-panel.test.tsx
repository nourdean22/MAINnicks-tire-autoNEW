/**
 * The gate panel must NEVER compute its own block rate.
 *
 * `buildEvidenceGateCalibration` returns `wouldBlockPct: null` below
 * MIN_SAMPLE, on purpose: "4 of 12" rendered as 33.3% invites exactly the
 * promotion this readout exists to gate, and the module's own header records
 * that the first measurement got it wrong in precisely that way. The server
 * holds that discipline — and a panel that divided `wouldBlock / turns` itself
 * would quietly undo it at the last step, which is the kind of last-mile
 * regression nothing else in the stack would notice.
 *
 * So the load-bearing assertion here is a NEGATIVE one: given a thin sample, no
 * percentage appears anywhere in the rendered output.
 *
 * Static markup + mocked trpc, following alert-inspector-states.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: null as unknown }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      evidenceGateCalibration: { useQuery: () => state.query },
    },
  },
}));

import { EvidenceGatePanel } from "@/components/system/evidence-gate-panel";

function cohort(
  over: Partial<{
    turns: number;
    wouldBlock: number;
    wouldBlockPct: number | null;
    byDriver: Record<string, number>;
  }> = {},
) {
  return {
    turns: 12,
    wouldBlock: 4,
    wouldBlockPct: null as number | null,
    byDriver: { named_claim: 1, fact_check: 3, length: 0, other: 0 },
    sample: [],
    ...over,
  };
}

function ok(over: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    isError: false,
    data: {
      generatedAt: "2026-09-17T02:00:00.000Z",
      cohortSince: "2026-09-16T08:56:00.000Z",
      minSample: 40,
      sufficient: false,
      beforeFix: cohort({ turns: 91, wouldBlock: 34, wouldBlockPct: 37.4 }),
      afterFix: cohort(),
      caveat: "Rate withheld below the minimum sample.",
      ...over,
    },
  };
}

/** Rendered text with tags stripped, so assertions read the words a human sees. */
function textOf(): string {
  state.query ??= ok();
  return renderToStaticMarkup(<EvidenceGatePanel />)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/g, "'")
    .replace(/\s+/g, " ");
}

afterEach(() => {
  state.query = null;
});

describe("EvidenceGatePanel", () => {
  it("POSITIVE CONTROL: it renders the readout at all", () => {
    // Without this, a component that threw or rendered nothing would satisfy
    // the "no percentage appears" assertion below completely vacuously.
    state.query = ok();
    const html = renderToStaticMarkup(<EvidenceGatePanel />);
    expect(html).toContain('aria-label="evidence-gate-calibration"');
    expect(html).toContain('data-testid="sample-progress"');
    expect(textOf()).toContain("12 / 40 turns");
  });

  it("NEVER computes a rate the server withheld", () => {
    state.query = ok();
    const text = textOf();

    // The after-fix cohort is 4/12, so a panel doing its own arithmetic renders
    // 33.3%. That exact value is the thing forbidden — NOT percentages in
    // general: the BEFORE-fix cohort has 91 turns and a server-stated 37.4%,
    // and rendering that is correct. A blanket "no % anywhere" assertion was
    // tried first and was simply wrong; it would have forced the panel to hide
    // a rate the data does support.
    expect(text).not.toMatch(/33(\.\d+)?\s*%/);
    expect(text).toContain("37.4%"); // the sufficient cohort still states its rate
    expect(text).toContain("rate withheld");
    // The raw counts are fine and useful — it is the RATE that is refused.
    expect(text).toContain("4/12 turns");
  });

  it("states DO NOT PROMOTE while the sample is below the floor", () => {
    state.query = ok();
    expect(textOf().toLowerCase()).toContain("do not promote");
  });

  it("shows the rate once the server says the sample is sufficient", () => {
    // The other side of the guard: when the server DOES state a rate, the panel
    // must render it rather than hiding behind the withheld branch forever.
    state.query = ok({
      sufficient: true,
      afterFix: cohort({ turns: 55, wouldBlock: 11, wouldBlockPct: 20 }),
    });
    const text = textOf();
    expect(text).toContain("20.0%");
    expect(text.toLowerCase()).toContain("sample sufficient");
  });

  it("names LENGTH as not an evidence signal", () => {
    // The driver split exists because promoting on an aggregate promotes
    // whichever component is loudest, and length is not an evidence signal at
    // all. Listing it as a peer of fact-check would rebuild the aggregate the
    // module took apart.
    state.query = ok({
      afterFix: cohort({ byDriver: { named_claim: 1, fact_check: 3, length: 5, other: 0 } }),
    });
    expect(textOf()).toContain("not an evidence signal");
  });

  it("a failed read reads as UNKNOWN, never as ready", () => {
    state.query = { isLoading: false, isError: true, data: undefined };
    const text = textOf().toLowerCase();
    expect(text).toContain("unknown, not ready");
    expect(text).not.toContain("sufficient");
  });
});
