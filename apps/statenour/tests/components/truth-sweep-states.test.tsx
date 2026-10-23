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

const UNKNOWN = "State unknown, not empty";
const OFFLINE_COPY = "Offline.";

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
