/**
 * CANARY · "0 promotable now" must never be printed off a read that failed.
 *
 * THE DEFECT, in two halves that only bite together:
 *
 *  · GET /api/knowledge/pipeline-status computed
 *    `statusCounts?.find(...)?.count ?? 0`, so a REJECTED groupBy produced a
 *    `promotableNow` of 0 that looked measured.
 *  · The route then correctly refused to assert `gateUnreachable` from missing
 *    data (its comment explains why at length), which routes this component
 *    into the NON-ALARM branch — and that branch printed the fabricated zero
 *    while the `degraded` list, the one thing that would have disclosed the
 *    failed read, rendered only inside the alarm card.
 *
 * So "cannot assert the gate is unreachable" was allowed to mean "healthy".
 * The route's reasoning was sound; the consumer's reading of it was not.
 *
 * The component's own effect never runs under renderToStaticMarkup, so the
 * quiet branch is exported and rendered directly with each payload shape.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Loader2: () => null,
}));
vi.mock("@/lib/utils/api-fetch", () => ({ apiFetch: vi.fn() }));

import { PipelineQuietLine } from "@/components/brain/research-pipeline-status";

type Status = Parameters<typeof PipelineQuietLine>[0]["status"];

const status = (over: Partial<Status> = {}): Status => ({
  totalClaims: 893,
  statusCounts: [{ status: "unverified", count: 876 }],
  bestVerificationScore: 0.58,
  promotableNow: 0,
  candidateRows: 0,
  thresholds: { strong: 0.75, weak: 0.5 },
  gateUnreachable: false,
  gateMeaning: "…",
  degraded: [],
  ...over,
});

describe("CANARY · the quiet branch can say 'unread'", () => {
  it("BREAKS: a rejected status query renders as unread, not as zero", () => {
    const html = renderToStaticMarkup(
      <PipelineQuietLine
        status={status({ statusCounts: null, promotableNow: null, degraded: ["status_counts"] })}
      />,
    );

    expect(html).not.toMatch(/0 promotable/);
    expect(html).toMatch(/unread/);
  });

  it("BREAKS: the degraded disclosure is reachable on the quiet path", () => {
    // It used to render ONLY inside the alarm card — the exact branch a
    // rejected read can never reach, because the rejection is what suppresses
    // the alarm. The disclosure was therefore unreachable precisely when it
    // was needed.
    const html = renderToStaticMarkup(
      <PipelineQuietLine
        status={status({
          statusCounts: null,
          promotableNow: null,
          totalClaims: null,
          degraded: ["status_counts", "claim_total"],
        })}
      />,
    );

    expect(html).toMatch(/degraded reads: status_counts, claim_total/);
  });

  it("positive control: a genuine measured zero still reads as a zero", () => {
    // The fix must not turn every quiet render into a hedge. A real 0 from a
    // successful groupBy is a fact and stays one, with no degraded line.
    const html = renderToStaticMarkup(<PipelineQuietLine status={status({ promotableNow: 0 })} />);

    expect(html).toMatch(/893 claims ingested/);
    expect(html).toMatch(/0 promotable now/);
    expect(html).not.toMatch(/unread/);
    expect(html).not.toMatch(/degraded/);
  });

  it("BREAKS: the two renders are not the same surface", () => {
    const unread = renderToStaticMarkup(
      <PipelineQuietLine status={status({ promotableNow: null, degraded: ["status_counts"] })} />,
    );
    const measured = renderToStaticMarkup(<PipelineQuietLine status={status({ promotableNow: 0 })} />);
    expect(unread).not.toEqual(measured);
  });
});
