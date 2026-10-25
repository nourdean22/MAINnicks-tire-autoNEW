/**
 * tests/components/brain/continuity-view-read-states.test.tsx - lens B review (2026-10-25).
 *
 * `continuity-view.tsx` ended its guards with `if (!data) return null`. A paused (offline) read has
 * no data, no error and `isLoading` false (lib/query-state.ts), so the whole continuity block on
 * /brain Health went blank on the phone with no word about why. A failed read printed its own
 * one-off block and hid any data already on screen. The house form is ReadStateNote
 * (components/ui/read-state-note.tsx): offline says offline, a failure says "state unknown, not
 * empty" with Retry, a failed refresh over data keeps the data and says it may be out of date.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Query = Record<string, unknown>;
let query: Query = {};

vi.mock("@/lib/trpc/client", () => ({
  trpc: { brain: { continuityReport: { useQuery: () => query } } },
}));
// Each child owns its own read and its own states test; none is under test here.
vi.mock("@/components/brain/receipts-timeline", () => ({ ReceiptsTimeline: () => null }));
vi.mock("@/components/brain/judgment-quality-panel", () => ({ JudgmentQualityPanel: () => null }));
vi.mock("@/components/brain/brain-change-line", () => ({ BrainChangeLine: () => null }));
// The Time Travel deep-link target (/brain?tab=health#time-travel), standing in for the four
// self-reading children: they must mount whatever state the continuity read is in.
vi.mock("@/components/brain/time-travel-panel", () => ({ TimeTravelPanel: () => <section id="time-travel" /> }));

import { BrainContinuityView } from "@/components/brain/continuity-view";

const payload = {
  totals: { allTime: 10, active: 9, expired: 1, byCategory: {} },
  recent: { created: [], reinforced: [], decayed: [], promoted: [], prunedLast24h: 2 },
  topReinforced: [],
  topConfidence: [],
  categoryMovers: [],
  computedAt: "2026-10-25T00:00:00.000Z",
};

function render(q: Query): string {
  query = { refetch: () => Promise.resolve(), ...q };
  return renderToStaticMarkup(<BrainContinuityView />);
}

describe("BrainContinuityView · every read state says what it is", () => {
  it("offline (paused, no data): the offline note, never a blank block", () => {
    const html = render({
      data: undefined,
      isError: false,
      error: null,
      isLoading: false,
      isPending: true,
      fetchStatus: "paused",
      status: "pending",
    });
    expect(html).toContain('data-read-state="offline"');
    expect(html).toContain("Offline. Memory continuity shows when the connection returns.");
  });

  it("CONTROL · data in hand: the view renders and no read-state note shows", () => {
    const html = render({ data: payload, isError: false, error: null, isLoading: false, fetchStatus: "idle", status: "success" });
    expect(html).toContain("Memory totals");
    expect(html).not.toContain("data-read-state");
  });

  it("failed read with no data: the error note with Retry, never blank", () => {
    const html = render({
      data: undefined,
      isError: true,
      error: { message: "boom" },
      isLoading: false,
      isPending: false,
      fetchStatus: "idle",
      status: "error",
    });
    expect(html).toContain('data-read-state="error"');
    expect(html).toContain("Memory continuity could not load. State unknown, not empty.");
    expect(html).toContain(">Retry<");
  });

  it("no data, nothing in flight, no error: an unknown, not a blank", () => {
    const html = render({ data: undefined, isError: false, error: null, isLoading: false, isPending: false, fetchStatus: "idle" });
    expect(html).toContain('data-read-state="error"');
  });

  it("failed refresh over data: keeps drawing the data and says it may be out of date", () => {
    const html = render({ data: payload, isError: true, error: { message: "boom" }, isLoading: false, fetchStatus: "idle", status: "error" });
    expect(html).toContain('data-read-state="stale"');
    expect(html).toContain("Memory totals");
  });

  it.each([
    ["offline", { data: undefined, isError: false, error: null, isLoading: false, isPending: true, fetchStatus: "paused" }],
    ["failed", { data: undefined, isError: true, error: { message: "boom" }, isLoading: false, isPending: false, fetchStatus: "idle" }],
    ["loading", { data: undefined, isError: false, error: null, isLoading: true, isPending: true, fetchStatus: "fetching" }],
    ["ready", { data: payload, isError: false, error: null, isLoading: false, fetchStatus: "idle" }],
  ])("%s continuity read: the self-reading blocks still mount, so #time-travel has a target", (_s, q) => {
    expect(render(q)).toContain('id="time-travel"');
  });

  it("CONTROL · loading: the spinner line, no read-state note", () => {
    const html = render({ data: undefined, isError: false, error: null, isLoading: true, isPending: true, fetchStatus: "fetching", status: "pending" });
    expect(html).toContain("reading the brain");
    expect(html).not.toContain("data-read-state");
  });
});
