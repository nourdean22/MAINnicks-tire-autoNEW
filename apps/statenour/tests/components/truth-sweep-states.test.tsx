/**
 * Truth sweep 2026-10-23, acceptance 1 and 2: a failed or paused read never renders as 0, idle,
 * hidden, ON or clean. Rendered markup, not source presence (the wisdom-evolution-panel-states
 * pattern): the vitest env is Node, renderToStaticMarkup is how this repo asserts on output.
 *
 * Each surface gets: error, offline, and a CONTROL where the same panel with real data still
 * renders it (a panel hard-wired to "state unknown" would pass the failure cases and tell the
 * operator nothing).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Q = Record<string, unknown>;
const q = vi.hoisted(() => ({ s: {} as Record<string, Record<string, unknown>> }));

const query = (o: Q = {}): Q => ({
  data: undefined,
  isLoading: false,
  isPending: false,
  isError: false,
  error: null,
  fetchStatus: "idle",
  refetch: () => {},
  ...o,
});
const ERROR: Q = { isError: true, error: { message: "boom" } };
const OFFLINE: Q = { isPending: true, fetchStatus: "paused" };

vi.mock("@/lib/trpc/client", () => {
  const mutation = { mutate: () => {}, mutateAsync: async () => ({}), isPending: false, isSuccess: false };
  const leaf = (key: string) => ({ useQuery: () => q.s[key], useMutation: () => mutation });
  return {
    trpc: {
      useUtils: () =>
        new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: async () => {} }) }) }),
      journal: {
        convergence: leaf("convergence"),
        runConvergenceScan: leaf("x"),
        createThread: leaf("x"),
        dismissCandidate: leaf("x"),
      },
      system: {
        forecastScoreboard: leaf("forecast"),
        forecastCreate: leaf("x"),
        autopilotFlags: leaf("rhythm"),
        setAutopilotFlags: leaf("x"),
      },
      operator: {
        featureFlags: leaf("flags"),
        setFeatureFlagOverride: leaf("x"),
        characterSheet: leaf("sheet"),
      },
    },
  };
});
vi.mock("@/lib/ui/haptic", () => ({ haptic: { select: () => {}, warn: () => {}, success: () => {}, error: () => {} } }));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: () => {} }));

import { ThreadRadar } from "@/components/journal/thread-radar";
import { ForecastDuel } from "@/components/stats/forecast-duel";
import { OperatingRhythmToggle } from "@/components/settings/operating-rhythm-toggle";
import { IntelligenceFlagsPanel } from "@/components/settings/intelligence-flags-panel";
import { StatsVerdict } from "@/components/stats/stats-verdict";
import { TrendCounter } from "@/components/ui/trend-counter";
import { ReadStateNote } from "@/components/ui/read-state-note";

const UNKNOWN = "State unknown, not empty";
const OFFLINE_COPY = "Offline.";
const STALE = "Last refresh failed.";
// A poll that failed after data arrived: isError true, data kept (react-query v5 keeps it).
const STALE_Q: Q = { isError: true, error: { message: "boom" } };
const FLAG = { key: "NICK_X", description: "d", status: "stable", onValue: "1", defaultBehavior: "off", rawValue: "1", isOn: true, overrideValue: null };
const DUEL = {
  operator: { resolved: 4, meanBrier: 0.2, last10Brier: 0.21 },
  agent: { resolved: 9, meanBrier: 0.18, last10Brier: 0.19 },
  pendingOperator: [],
};

beforeEach(() => {
  q.s = {};
});

describe("ThreadRadar", () => {
  it("a failed read says state unknown and does not offer a scan as if nothing were wrong", () => {
    q.s.convergence = query(ERROR);
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain(UNKNOWN);
    expect(html).toContain("Retry");
    expect(html).not.toContain("Scan radar now");
  });
  it("a paused read says offline", () => {
    q.s.convergence = query(OFFLINE);
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain(OFFLINE_COPY);
    expect(html).not.toContain("Scan radar now");
  });
  it("control: a healthy empty radar still offers the scan, with a 44px box", () => {
    q.s.convergence = query({ data: [] });
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain("Scan radar now");
    expect(html).not.toContain(UNKNOWN);
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain("min-h-[32px]");
  });
});

describe("ForecastDuel", () => {
  it("a failed read is not hidden", () => {
    q.s.forecast = query(ERROR);
    const html = renderToStaticMarkup(<ForecastDuel />);
    expect(html).toContain("Forecast duel");
    expect(html).toContain(UNKNOWN);
  });
  it("a paused read does not print '0 resolved' for both lanes", () => {
    q.s.forecast = query(OFFLINE);
    const html = renderToStaticMarkup(<ForecastDuel />);
    expect(html).toContain(OFFLINE_COPY);
    expect(html).not.toContain("0 resolved");
  });
  it("control: real data prints both lanes", () => {
    q.s.forecast = query({
      data: {
        operator: { resolved: 4, meanBrier: 0.2, last10Brier: 0.21 },
        agent: { resolved: 9, meanBrier: 0.18, last10Brier: 0.19 },
        pendingOperator: [],
      },
    });
    const html = renderToStaticMarkup(<ForecastDuel />);
    expect(html).toContain("4 resolved");
    expect(html).toContain("9 resolved");
    expect(html).not.toContain(UNKNOWN);
  });
});

describe("OperatingRhythmToggle", () => {
  it("a failed read does not show the switch ON", () => {
    q.s.rhythm = query(ERROR);
    const html = renderToStaticMarkup(<OperatingRhythmToggle />);
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("On: Telegram checkpoints");
    expect(html).toContain(UNKNOWN);
  });
  it("a paused read does not show the switch ON", () => {
    q.s.rhythm = query(OFFLINE);
    const html = renderToStaticMarkup(<OperatingRhythmToggle />);
    expect(html).not.toContain('role="switch"');
    expect(html).toContain(OFFLINE_COPY);
  });
  it("control: a saved false reads OFF, an absent flag reads ON", () => {
    q.s.rhythm = query({ data: { flags: { adhd_operating_rhythm: false } } });
    expect(renderToStaticMarkup(<OperatingRhythmToggle />)).toContain('aria-checked="false"');
    q.s.rhythm = query({ data: { flags: {} } });
    expect(renderToStaticMarkup(<OperatingRhythmToggle />)).toContain('aria-checked="true"');
  });
});

describe("IntelligenceFlagsPanel", () => {
  it("a failed read is not '0 Active / 0 Total' or an empty search", () => {
    q.s.flags = query(ERROR);
    const html = renderToStaticMarkup(<IntelligenceFlagsPanel />);
    expect(html).toContain(UNKNOWN);
    expect(html).not.toContain("0 Total");
    expect(html).not.toContain("No feature flags found");
  });
  it("a paused read says offline", () => {
    q.s.flags = query(OFFLINE);
    expect(renderToStaticMarkup(<IntelligenceFlagsPanel />)).toContain(OFFLINE_COPY);
  });
  it("control: real flags list with a count", () => {
    q.s.flags = query({
      data: {
        flags: [
          { key: "NICK_X", description: "d", status: "stable", onValue: "1", defaultBehavior: "off", rawValue: "1", isOn: true, overrideValue: null },
        ],
      },
    });
    const html = renderToStaticMarkup(<IntelligenceFlagsPanel />);
    expect(html).toContain("NICK_X");
    expect(html).toContain("1 Total");
  });
});

describe("StatsVerdict", () => {
  it("a paused read says offline, not 'Reading your stats.'", () => {
    q.s.sheet = query(OFFLINE);
    const html = renderToStaticMarkup(<StatsVerdict />);
    expect(html).toContain(OFFLINE_COPY);
    expect(html).not.toContain("Reading your stats.");
  });
  it("control: a read in flight still says reading", () => {
    q.s.sheet = query({ isLoading: true, isPending: true, fetchStatus: "fetching" });
    expect(renderToStaticMarkup(<StatsVerdict />)).toContain("Reading your stats.");
  });
});

describe("TrendCounter", () => {
  it("a missing value renders n/a, never 0", () => {
    const html = renderToStaticMarkup(<TrendCounter value={null} label="days to review" />);
    expect(html).toContain("n/a");
    expect(html).not.toMatch(/>0</);
  });
  it("a missing value ignores a formatter that would turn null into a number", () => {
    const html = renderToStaticMarkup(<TrendCounter value={null} label="avg" format={(n) => `${n.toFixed(1)}/4`} />);
    expect(html).toContain("n/a");
    expect(html).not.toContain("0.0/4");
  });
  it("control: a real zero is a zero", () => {
    expect(renderToStaticMarkup(<TrendCounter value={0} label="x" format={(n) => `${n}`} />)).toContain(">0<");
  });
});

describe("stale: a failed refresh keeps the data AND says so (empty-vs-error, cached data is not current data)", () => {
  it("IntelligenceFlagsPanel: the flags stay, the note renders with Retry", () => {
    q.s.flags = query({ data: { flags: [FLAG] }, ...STALE_Q });
    const html = renderToStaticMarkup(<IntelligenceFlagsPanel />);
    expect(html).toContain("NICK_X");
    expect(html).toContain("1 Total");
    expect(html).toContain(STALE);
    expect(html).toContain("Retry");
    expect(html).not.toContain(UNKNOWN);
  });
  it("ThreadRadar: an empty cached radar still says the refresh failed", () => {
    q.s.convergence = query({ data: [], ...STALE_Q });
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain(STALE);
    expect(html).toContain("Retry");
  });
  it("ThreadRadar: cached themes stay under the note", () => {
    q.s.convergence = query({
      data: [{ clusterHash: "h1", size: 3, coherence: 0.8, nameSuggestions: ["Sleep"], detectedAt: "2026-10-01T00:00:00Z", members: [] }],
      ...STALE_Q,
    });
    const html = renderToStaticMarkup(<ThreadRadar />);
    expect(html).toContain(STALE);
    expect(html).toContain("Coalescing");
  });
  it("ForecastDuel: both lanes stay, the note renders", () => {
    q.s.forecast = query({ data: DUEL, ...STALE_Q });
    const html = renderToStaticMarkup(<ForecastDuel />);
    expect(html).toContain("4 resolved");
    expect(html).toContain(STALE);
  });
  it("OperatingRhythmToggle: the switch stays (its value was read), the note renders", () => {
    q.s.rhythm = query({ data: { flags: { adhd_operating_rhythm: false } }, ...STALE_Q });
    const html = renderToStaticMarkup(<OperatingRhythmToggle />);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(STALE);
  });
  it("control: a healthy read prints no stale note on any of the four", () => {
    q.s.flags = query({ data: { flags: [FLAG] } });
    q.s.convergence = query({ data: [] });
    q.s.forecast = query({ data: DUEL });
    q.s.rhythm = query({ data: { flags: {} } });
    for (const el of [<IntelligenceFlagsPanel key="a" />, <ThreadRadar key="b" />, <ForecastDuel key="c" />, <OperatingRhythmToggle key="d" />]) {
      expect(renderToStaticMarkup(el)).not.toContain(STALE);
    }
  });
});

describe("ReadStateNote", () => {
  it("stale renders a status note with the copy and a Retry", () => {
    const html = renderToStaticMarkup(<ReadStateNote state="stale" label="Feature flags" onRetry={() => {}} />);
    expect(html).toContain('data-read-state="stale"');
    expect(html).toContain("Last refresh failed. Feature flags below may be out of date.");
    expect(html).toContain("Retry");
  });
  it("Retry is a 44 by 44 target, wide enough for its word (target-size.spec checks width)", () => {
    for (const state of ["error", "stale"] as const) {
      const html = renderToStaticMarkup(<ReadStateNote state={state} label="x" onRetry={() => {}} />);
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain("min-w-[44px]");
      expect(html).toContain("justify-center");
    }
  });
  it("while a Retry is in flight the button is disabled and says Retrying", () => {
    for (const state of ["error", "stale"] as const) {
      const html = renderToStaticMarkup(<ReadStateNote state={state} label="x" onRetry={() => {}} retrying />);
      expect(html).toContain("Retrying");
      expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    }
    const idle = renderToStaticMarkup(<ReadStateNote state="error" label="x" onRetry={() => {}} />);
    expect(idle).not.toContain("Retrying");
    expect(idle).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
  it("offline offers no Retry (the read runs when the connection returns)", () => {
    expect(renderToStaticMarkup(<ReadStateNote state="offline" label="x" onRetry={() => {}} />)).not.toContain("Retry");
  });
});

describe("a Retry that is running reaches the screen through the real panels", () => {
  it("ThreadRadar error with a refetch in flight reads Retrying", () => {
    q.s.convergence = query({ ...ERROR, fetchStatus: "fetching" });
    expect(renderToStaticMarkup(<ThreadRadar />)).toContain("Retrying");
  });
  it("IntelligenceFlagsPanel stale with a refetch in flight reads Retrying", () => {
    q.s.flags = query({ data: { flags: [FLAG] }, ...STALE_Q, fetchStatus: "fetching" });
    expect(renderToStaticMarkup(<IntelligenceFlagsPanel />)).toContain("Retrying");
  });
});
