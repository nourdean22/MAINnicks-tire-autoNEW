/**
 * The /system Detail fold hides eight blocks behind a closed summary (wave E1, 2026-10-24).
 * Two promises, asserted per block:
 *   1. empty-vs-error: a failed read renders its own "state unknown" line AND carries
 *      `data-read-failed`, the marker the fold summary counts, so a closed fold can say
 *      "n unreadable" for blocks that fetch for themselves.
 *   2. idiom: the loading state is the house ShimmerSkeleton (`data-skeleton`), not a hand-rolled
 *      animate-pulse bar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; isFetching?: boolean; error?: { message: string } | null };
const state = vi.hoisted(() => ({ q: {} as Q }));

vi.mock("@/lib/trpc/client", () => {
  const node: unknown = new Proxy(function () {}, {
    get: (_t, key: string) => {
      if (key === "useQuery") return () => ({ refetch: async () => {}, dataUpdatedAt: 0, ...state.q });
      if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
      if (key === "useUtils") return () => node;
      return node;
    },
    apply: () => node,
  });
  return { trpc: node };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { WiringCensusPanel } from "@/components/system/wiring-census-panel";
import { TrustLadderPanel } from "@/components/system/trust-ladder-panel";
import { HomeDecisionPanel } from "@/components/system/home-decision-panel";
import { ToolUsageCensusPanel } from "@/components/system/tool-usage-census-panel";
import { EvidenceGatePanel } from "@/components/system/evidence-gate-panel";
import { StaleDataPanel } from "@/components/system/stale-data-panel";
import { ObservabilityStatusPanel } from "@/components/system/observability-status-panel";
import { AgendaDesk } from "@/components/system/agenda-desk";

const FAILED: Q = { data: undefined, isError: true, isLoading: false, error: { message: "boom" } };
const LOADING: Q = { data: undefined, isError: false, isLoading: true };

const blocks: { name: string; render: () => string; skeleton: boolean }[] = [
  { name: "wiring census", render: () => renderToStaticMarkup(<WiringCensusPanel />), skeleton: true },
  { name: "trust ladder", render: () => renderToStaticMarkup(<TrustLadderPanel />), skeleton: true },
  { name: "home decision", render: () => renderToStaticMarkup(<HomeDecisionPanel />), skeleton: true },
  { name: "tool usage census", render: () => renderToStaticMarkup(<ToolUsageCensusPanel />), skeleton: true },
  { name: "evidence gate", render: () => renderToStaticMarkup(<EvidenceGatePanel />), skeleton: true },
  { name: "stale data", render: () => renderToStaticMarkup(<StaleDataPanel />), skeleton: false },
  { name: "observability status", render: () => renderToStaticMarkup(<ObservabilityStatusPanel />), skeleton: false },
  {
    name: "agenda desk",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: () => renderToStaticMarkup(<AgendaDesk queryResult={{ ...state.q } as any} />),
    skeleton: true,
  },
];

afterEach(() => {
  state.q = {};
});

describe("Detail fold blocks: failed read", () => {
  for (const b of blocks) {
    it(`${b.name} marks its failed read so the closed fold can count it`, () => {
      state.q = FAILED;
      const html = b.render();
      expect(html, b.name).toContain("data-read-failed");
      expect(html, b.name).toMatch(/unknown|not (empty|healthy|clean|zero|ready)|failed/i);
    });
  }

  it("control: a loading block is not marked failed", () => {
    for (const b of blocks) {
      state.q = LOADING;
      expect(b.render(), b.name).not.toContain("data-read-failed");
    }
  });
});

// A paused query (offline client navigation) has no data and no error. The three panels below used to
// branch on isError only and drew zeros / "auto-execute OFF" / "No lanes derived" from nothing.
const PAUSED: Q & { fetchStatus: string } = { data: undefined, isError: false, isLoading: false, fetchStatus: "paused" };
const IDLE_NO_DATA: Q & { fetchStatus: string } = { data: undefined, isError: false, isLoading: false, fetchStatus: "idle" };
const THREE = blocks.filter((b) => ["wiring census", "trust ladder", "home decision"].includes(b.name));

describe("Detail fold blocks: a paused or data-less read invents nothing", () => {
  for (const b of THREE) {
    it(`${b.name}: paused says offline and draws no numbers`, () => {
      state.q = PAUSED;
      const html = b.render();
      expect(html, b.name).toContain("Offline.");
      expect(html, b.name).not.toMatch(/Verdicts|Resumes|Active days|auto-execute|No lanes derived/);
      expect(html, b.name).not.toContain("data-read-failed");
    });
    it(`${b.name}: no data and no error is the failed state, counted by the fold`, () => {
      state.q = IDLE_NO_DATA;
      const html = b.render();
      expect(html, b.name).toContain("data-read-failed");
      expect(html, b.name).not.toMatch(/Verdicts|Resumes|Active days|auto-execute|No lanes derived/);
    });
  }
});

// The Langfuse lane line is a claim about the SERVER ("not initialized: no init outcome reported on this
// boot"). A read that never ran has no such outcome to report, so it must say "not measured", never
// draw that verdict (lens B review P2, 2026-10-25). The control keeps the real text for a COMPLETED read.
describe("observability status: a read that never ran is not a server verdict", () => {
  const VERDICT = /not initialized|no init outcome reported/;
  const render = () => renderToStaticMarkup(<ObservabilityStatusPanel />);

  it("paused (offline) says offline and draws no Langfuse verdict", () => {
    state.q = PAUSED;
    const html = render();
    expect(html).toContain("Offline.");
    expect(html).not.toMatch(VERDICT);
    expect(html).not.toContain("data-read-failed");
  });

  it("no data and no error on an idle query is the failed state, counted by the fold", () => {
    state.q = IDLE_NO_DATA;
    const html = render();
    expect(html).toContain("data-read-failed");
    expect(html).not.toMatch(VERDICT);
  });

  // Braintrust is static truth (the wrapper was deleted 2026-08-25): it needs no read, so no read state hides it.
  const BRAINTRUST = "wrap removed 2026-08-25";
  it("paused: the static Braintrust line is still there beside the offline note", () => {
    state.q = PAUSED;
    const html = render();
    expect(html).toContain("Offline.");
    expect(html).toContain("Braintrust");
    expect(html).toContain(BRAINTRUST);
  });

  it("failed and idle-no-data reads keep the static Braintrust line too", () => {
    for (const q of [{ ...FAILED, fetchStatus: "idle" }, IDLE_NO_DATA] as Q[]) {
      state.q = q;
      const html = render();
      expect(html).toContain("data-read-failed");
      expect(html).toContain(BRAINTRUST);
    }
  });

  it("control: a completed read renders both lanes", () => {
    state.q = { data: { langfuse: {} }, isError: false, isLoading: false, fetchStatus: "idle" } as Q;
    const html = render();
    expect(html).toContain("Langfuse");
    expect(html).toContain("not initialized");
    expect(html).toContain("Braintrust");
    expect(html).toContain(BRAINTRUST);
  });

  it("control: a COMPLETED read with no init outcome keeps its real 'not initialized' text", () => {
    state.q = { data: { langfuse: {} }, isError: false, isLoading: false, fetchStatus: "idle" } as Q;
    const html = render();
    expect(html).toContain("not initialized");
    expect(html).toContain("no init outcome reported on this boot");
    expect(html).not.toContain("Offline.");
    expect(html).not.toContain("data-read-failed");
  });

  it("control: a completed read with a real outcome still shows it", () => {
    state.q = { data: { langfuse: { status: "started" } }, isError: false, isLoading: false, fetchStatus: "idle" } as Q;
    const html = render();
    expect(html).toContain("tracing live");
    expect(html).not.toMatch(VERDICT);
  });

  it("a failed read still renders the error line, never a verdict", () => {
    state.q = { ...FAILED, fetchStatus: "idle" } as Q;
    const html = render();
    expect(html).toContain("data-read-failed");
    expect(html).toContain("Health read failed");
    expect(html).not.toMatch(VERDICT);
  });
});

describe("Detail fold blocks: loading uses ShimmerSkeleton", () => {
  for (const b of blocks.filter((x) => x.skeleton)) {
    it(`${b.name} loading state is a house skeleton, not animate-pulse`, () => {
      state.q = LOADING;
      const html = b.render();
      expect(html, b.name).toContain("data-skeleton");
      expect(html, b.name).not.toContain("animate-pulse");
    });
  }
});
