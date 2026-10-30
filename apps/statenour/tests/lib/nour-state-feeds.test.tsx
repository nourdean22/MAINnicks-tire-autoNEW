/**
 * UI v3 W1a review round 3, item 2: what the provider makes of the four feeds.
 *
 * A 503 health body whose drift MetricResult (`alerts` until 2026-10-29) is unavailable used to pass readHealthFeed, leave
 * failedFeeds at 0, and turn the missing count into 0 alerts, so the word read "Steady" about a state
 * nobody measured. summarizeFeeds is the pure step NourStateProvider.loadAll now runs; the alert count is
 * the drift signal, so when it is unavailable the state is unknown. (No DOM here: the provider's effect
 * cannot run under renderToString, and jsdom is not installed, so the reducer is tested directly.)
 */
import { describe, expect, it } from "vitest";
import { summarizeFeeds } from "@/lib/state/health-feed";
import { stateWord } from "@/lib/state/state-word";

const ok = { habitsData: { habits: [] }, streaksData: { streaks: [] }, cmd: { shop: {}, brief: {}, brain: {}, system: {} } };
const word = (s: ReturnType<typeof summarizeFeeds>, currentState: "normal" | "drift") =>
  stateWord({ currentState, isLoading: false, error: null, systemStatus: s.systemStatus, failedFeeds: s.failedFeeds });

describe("summarizeFeeds", () => {
  it("503 degraded with the drift metric unavailable: a failed feed, no alert count, State unknown", () => {
    const s = summarizeFeeds({ health: { status: "degraded", drift: { status: "unavailable", source: "db", errorCode: "ECONN" } }, ...ok });
    expect(s.systemStatus).toBe("degraded");
    expect(s.driftAlerts).toBeNull();
    expect(s.failedFeeds).toBe(1);
    expect(word(s, "normal")).toEqual({ text: "State unknown", tone: "unknown" });
  });

  it("503 degraded with the drift metric present: the real count, no failed feed, the real state", () => {
    const s = summarizeFeeds({ health: { status: "degraded", drift: { status: "ok", value: { unresolved: 2 }, measuredAt: "x", source: "db" } }, ...ok });
    expect(s.failedFeeds).toBe(0);
    expect(s.driftAlerts).toBe(2);
    expect(word(s, "drift")).toEqual({ text: "Drifting", tone: "signal" });
  });

  it("a health feed that returned nothing is one failed feed and an unknown status", () => {
    const s = summarizeFeeds({ health: null, ...ok });
    expect(s.systemStatus).toBe("unknown");
    expect(s.failedFeeds).toBe(1);
    expect(s.driftAlerts).toBeNull();
  });

  it("every other missing feed counts once", () => {
    const s = summarizeFeeds({ health: { status: "healthy", drift: { status: "ok", value: { unresolved: 0 }, measuredAt: "x", source: "db" } }, habitsData: null, streaksData: null, cmd: null });
    expect(s.failedFeeds).toBe(3);
  });
});
