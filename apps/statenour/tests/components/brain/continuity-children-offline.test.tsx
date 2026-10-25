/**
 * tests/components/brain/continuity-children-offline.test.tsx - lens B round 2 (Codex P2 on PR 3283).
 *
 * The continuity view now mounts its self-reading children in every state, including offline before any
 * read has data. A paused React Query read has no data, no error and isLoading false
 * (lib/query-state.ts), so a child that branched only on isLoading/isError fell through to its data
 * branch: ReceiptsTimeline printed "0 in window" and "No receipts in the current window", and
 * JudgmentQualityPanel drew its promotion counts from undefined. Each must say offline instead.
 * (BrainChangeLine renders nothing until its read succeeds; TimeTravelPanel reads only on a tap.)
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const store = vi.hoisted(() => ({ q: {} as Record<string, Record<string, unknown>> }));
const paused = { data: undefined, isError: false, error: null, isLoading: false, isPending: true, fetchStatus: "paused", status: "pending" };
const ready = (data: unknown) => ({ data, isError: false, error: null, isLoading: false, isPending: false, fetchStatus: "idle", status: "success" });

vi.mock("@/lib/trpc/client", () => {
  const proc = (name: string) => ({ useQuery: () => ({ refetch: () => Promise.resolve(), ...store.q[name] }) });
  return { trpc: { system: new Proxy({}, { get: (_t, name: string) => proc(name) }) } };
});

import { ReceiptsTimeline } from "@/components/brain/receipts-timeline";
import { JudgmentQualityPanel } from "@/components/brain/judgment-quality-panel";

const spc = { totals: { total: 5, promoted: 3, gateRejected: 1, dupeSkipped: 1, failed: 0, parked: 0 }, underSampled: false, decided: 5, weeks: [] };
const cal = { note: null, bands: [{ band: "HIGH", hitRate: 0.5, kept: 1, resolved: 2, unresolved: 0 }] };

describe("continuity children: a paused read says offline, never zero or empty", () => {
  it("receipts offline before data: the offline note, no zero count, no empty-list sentence", () => {
    store.q = { receiptFeed: paused };
    const html = renderToStaticMarkup(<ReceiptsTimeline limit={30} />);
    expect(html).toContain('data-read-state="offline"');
    expect(html).not.toContain("0 in window");
    expect(html).not.toContain("No receipts");
  });

  it("CONTROL · receipts with data: the counts render", () => {
    store.q = { receiptFeed: ready({ items: [], counts: { total: 3, success: 2, failed: 1, other: 0 } }) };
    const html = renderToStaticMarkup(<ReceiptsTimeline limit={30} />);
    expect(html).toContain("3 in window");
    expect(html).not.toContain("data-read-state");
  });

  it("judgment quality offline before data: the offline note, no counts drawn from nothing", () => {
    store.q = { wisdomGateSpc: paused, takeCalibration: paused };
    const html = renderToStaticMarkup(<JudgmentQualityPanel />);
    expect(html).toContain('data-read-state="offline"');
    expect(html).not.toContain("promoted ·");
    expect(html).not.toContain("Stated confidence");
  });

  it("judgment quality: one of its two reads paused is still offline, not half a panel", () => {
    store.q = { wisdomGateSpc: ready(spc), takeCalibration: paused };
    const html = renderToStaticMarkup(<JudgmentQualityPanel />);
    expect(html).toContain('data-read-state="offline"');
    expect(html).not.toContain("Stated confidence");
  });

  it("CONTROL · judgment quality with data: the readings render", () => {
    store.q = { wisdomGateSpc: ready(spc), takeCalibration: ready(cal) };
    const html = renderToStaticMarkup(<JudgmentQualityPanel />);
    expect(html).toContain("3 promoted");
    expect(html).toContain("50% kept");
    expect(html).not.toContain("data-read-state");
  });
});
