/**
 * tests/components/eval-tile-stale-polish.test.tsx · task P2-B1 (2026-10-10).
 *
 * Follow-up to the eval tile freshness gate (B1):
 *   1. The gate checked only results[0], but the trend reads results[1..6]
 *      from a limit-8 query, so months-old fossil rows (passRate 0) fed the
 *      "7d trend". Rows older than the window must be dropped first.
 *   2. The shared EmptyTile always printed "endpoint quiet · check back after
 *      first run", which contradicts the stale hint "last eval run 2026-05-27,
 *      no runs since". The stale eval tile needs its own truthful footer.
 *
 * renderToString (node env), same as observability-tiles.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";

import { EmptyTile } from "@/components/ultron/observability/cost-slo-tile";
import { EvalPassRateTile } from "@/components/ultron/observability/eval-pass-rate-tile";
import { classifyEvals, type EvalResultsShape } from "@/hooks/use-observability";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const DEFAULT_FOOTER = "endpoint quiet · check back after first run";

type Row = NonNullable<EvalResultsShape["results"]>[number];
const row = (id: string, ranAt: string, passRate: number): Row => ({
  id,
  ranAt,
  passed: Math.round(passRate * 10),
  failed: 10 - Math.round(passRate * 10),
  totalRan: 10,
  passRate,
});
const query = (results: Row[]) => ({
  isLoading: false,
  isError: false,
  refetch: () => {},
  data: { count: results.length, results },
});

const FRESH_LATEST = row("fresh-1", "2026-10-09T06:00:00.000Z", 0.9);
const FRESH_PRIOR = row("fresh-2", "2026-10-08T06:00:00.000Z", 0.8);
const FOSSIL = row("fossil", "2026-05-27T06:00:00.000Z", 0);

describe("classifyEvals · rows behind a fresh latest are window-gated too", () => {
  it("a fresh row plus a 2026-05-27 row keeps only the fresh row", () => {
    const state = classifyEvals(query([FRESH_LATEST, FOSSIL]), NOW);
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.data.results?.map((r) => r.id)).toEqual(["fresh-1"]);
  });

  it("the trend is computed over fresh rows only, not dragged down by the fossil", () => {
    const html = renderToString(
      <EvalPassRateTile state={classifyEvals(query([FRESH_LATEST, FRESH_PRIOR, FOSSIL]), NOW)} />,
    );
    // fresh-only: 90 vs avg(80) = up 10pp. With the fossil: 90 vs avg(80, 0) = up 50pp.
    expect(html).toMatch(/up 10pp/);
    expect(html).not.toMatch(/up 50pp/);
  });

  it("positive control: all-fresh history keeps every row", () => {
    const state = classifyEvals(query([FRESH_LATEST, FRESH_PRIOR]), NOW);
    expect(state.kind === "ready" && state.data.results?.map((r) => r.id)).toEqual([
      "fresh-1",
      "fresh-2",
    ]);
  });
});

describe("EmptyTile footer", () => {
  it("defaults to the existing footer when none is passed", () => {
    const html = renderToString(<EmptyTile label="os · drift" hint="no snapshot yet" />);
    expect(html).toContain(DEFAULT_FOOTER);
  });

  it("renders a passed footer instead of the default", () => {
    const html = renderToString(
      <EmptyTile label="eval · pass rate" hint="h" footer="custom footer text" />,
    );
    expect(html).toContain("custom footer text");
    expect(html).not.toContain(DEFAULT_FOOTER);
  });
});

describe("EvalPassRateTile · one truthful footer", () => {
  it("the stale hint gets a footer that does not promise a first run", () => {
    const html = renderToString(
      <EvalPassRateTile state={classifyEvals(query([FOSSIL]), NOW)} />,
    );
    expect(html).toContain("last eval run 2026-05-27, no runs since");
    expect(html).toContain("no eval writer is wired");
    expect(html).not.toContain(DEFAULT_FOOTER);
  });

  it("positive control: the never-ran empty state keeps the default footer", () => {
    const html = renderToString(<EvalPassRateTile state={{ kind: "empty" }} />);
    expect(html).toContain("no regression runs yet");
    expect(html).toContain(DEFAULT_FOOTER);
  });
});
