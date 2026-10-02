/**
 * v10.0.526 · tests/components/observability-tiles.test.tsx
 *
 * Smoke + state-machine coverage for the four Ultron observability tiles.
 * Vitest runs in `environment: "node"` (per vitest.config.ts) — we
 * deliberately use `react-dom/server.renderToString` so the tests work
 * without adding jsdom as a dep. Renders are static markup; any state
 * machine that crashes or emits the wrong textual signal will fail here
 * before it lands in production.
 *
 * Coverage matrix (4+ render tests required by the spec):
 *   1. CostSloTile  · loading skeleton (state.kind = "loading")
 *   2. CostSloTile  · happy state with sparkline data
 *   3. VoiceLatencyTile · red tier on P50 > 800ms
 *   4. VoiceLatencyTile · empty state · "no calls in window" hint
 *   5. EvalPassRateTile · error state surfaces the error text
 *   6. EvalPassRateTile · happy state with worst-category meta
 *   7. OsDriftTile · happy state shows row labels + deltas
 *   8. Pure helpers · formatUsd · latencyTier · passRateTier · signedDelta
 *
 * Why not @testing-library/react? Adding it would mean adding jsdom +
 * testing-library — two new top-level deps for what these tests need
 * (a string of HTML to assert against). The brief was explicit: DO NOT
 * install npm deps. renderToString is enough.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";

import { CostSloTile } from "@/components/ultron/observability/cost-slo-tile";
import { VoiceLatencyTile } from "@/components/ultron/observability/voice-latency-tile";
import { EvalPassRateTile } from "@/components/ultron/observability/eval-pass-rate-tile";
import { OsDriftTile } from "@/components/ultron/observability/os-drift-tile";
import {
  formatUsd,
  latencyTier,
  passRateTier,
  signedDelta,
} from "@/hooks/use-observability";

// ── Tile render coverage ────────────────────────────────────────────────

describe("CostSloTile", () => {
  it("renders loading skeleton without crashing", () => {
    const html = renderToString(<CostSloTile state={{ kind: "loading" }} />);
    // The skeleton uses the shimmer animation class — that's the marker
    // we lock onto. Don't over-specify the markup; we just want a sanity
    // signal that the loading branch actually rendered.
    expect(html.length).toBeGreaterThan(0);
    expect(html).toMatch(/shimmer|animate/i);
  });

  it("renders happy state with cost + budget + forecast", () => {
    const html = renderToString(
      <CostSloTile
        state={{
          kind: "ready",
          data: {
            burnUsdToday: 12.4,
            dailyBudgetUsd: 50,
            burn7d: [8.1, 9.3, 11.0, 10.2, 13.7, 12.0, 12.4],
            forecastUsdEod: 18.2,
            topConversations: [
              { id: "a", label: "deep-research dive", usd: 4.2 },
              { id: "b", label: "code-audit batch", usd: 3.1 },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("$12.40"); // burn
    expect(html).toContain("$50.00"); // cap
    expect(html).toContain("$18.20"); // forecast EOD
    // 12.4 / 50 = 24.8% → rounded to 25% of cap · React SSR injects
    // <!-- --> between adjacent text nodes, so we strip them before
    // asserting on the human-readable copy.
    const norm = (s: string) => s.replace(/<!--\s*-->/g, "");
    expect(norm(html)).toMatch(/25% of cap/);
    expect(norm(html)).toMatch(/top conv/i);
  });
});

describe("VoiceLatencyTile", () => {
  it("renders red tier when P50 breaches the 800ms ceiling", () => {
    const html = renderToString(
      <VoiceLatencyTile
        state={{
          kind: "ready",
          data: {
            p50Ms: 950,
            p95Ms: 1400,
            recentMs: [810, 880, 920, 950],
            breachStreak: 4,
            redThresholdMs: 800,
            amberThresholdMs: 500,
          },
        }}
      />,
    );
    const norm = (s: string) => s.replace(/<!--\s*-->/g, "");
    expect(html).toContain("950");
    expect(html).toMatch(/broken/i); // tier text label
    expect(norm(html)).toMatch(/p95 1400ms/);
    // Streak ≥ 3 → "investigate" copy
    expect(norm(html)).toMatch(/investigate/i);
  });

  it("renders empty state pointing at Nick's Tire admin", () => {
    // 2026-10-02 · voice runs on nickstire; statenour's table has no writer,
    // so "no calls" read as "no traffic" when the phone line was busy.
    const html = renderToString(<VoiceLatencyTile state={{ kind: "empty" }} />);
    expect(html).toMatch(/voice latency/i);
    expect(html).toMatch(/measured in Nick(&#x27;|')s Tire admin/i);
    expect(html).not.toMatch(/no calls/i);
    expect(html).toMatch(/endpoint quiet/i);
  });
});

describe("EvalPassRateTile", () => {
  it("renders the error message in error state", () => {
    const html = renderToString(
      <EvalPassRateTile
        state={{ kind: "error", message: "500 Internal Server Error" }}
      />,
    );
    expect(html).toMatch(/500 Internal Server Error/);
    expect(html).toMatch(/failed/i);
  });

  it("renders happy state with worst category + pass count", () => {
    const html = renderToString(
      <EvalPassRateTile
        state={{
          kind: "ready",
          data: {
            count: 2,
            results: [
              {
                id: "r1",
                ranAt: "2026-05-12T00:00:00Z",
                passed: 18,
                failed: 2,
                totalRan: 20,
                passRate: 0.9,
                worstCategories: [
                  { category: "tool-use", failed: 2, total: 4 },
                ],
              },
              {
                id: "r0",
                ranAt: "2026-05-11T00:00:00Z",
                passed: 16,
                failed: 4,
                totalRan: 20,
                passRate: 0.8,
              },
            ],
          },
        }}
      />,
    );
    const norm = (s: string) => s.replace(/<!--\s*-->/g, "");
    expect(html).toContain("90"); // pass rate %
    expect(norm(html)).toMatch(/18\/20 passed/);
    expect(html).toMatch(/tool-use/);
    expect(norm(html)).toMatch(/2\/4 fail/);
  });
});

describe("OsDriftTile", () => {
  it("renders all four metric rows in happy state with deltas", () => {
    const html = renderToString(
      <OsDriftTile
        state={{
          kind: "ready",
          data: {
            now: { routes: 142, crons: 18, tools: 24, monsters: 7 },
            prior: { routes: 140, crons: 18, tools: 22, monsters: 9 },
            generatedAt: "2026-05-12T00:00:00Z",
            monsterLocThreshold: 800,
          },
        }}
      />,
    );
    const norm = (s: string) => s.replace(/<!--\s*-->/g, "");
    expect(html).toMatch(/routes/);
    expect(html).toMatch(/crons/);
    expect(html).toMatch(/tools/);
    expect(html).toMatch(/monsters/);
    expect(html).toContain("142");
    expect(html).toContain("+2"); // routes delta
    expect(html).toContain("-2"); // monsters delta (improving)
    expect(norm(html)).toMatch(/monster &gt; 800 LOC/);
  });
});

// ── Pure helper coverage ────────────────────────────────────────────────

describe("formatUsd", () => {
  it("formats sub-dollar amounts with 3 decimals", () => {
    expect(formatUsd(0.04)).toBe("$0.040");
  });
  it("formats $1+ amounts with 2 decimals", () => {
    expect(formatUsd(12.4)).toBe("$12.40");
  });
  it("collapses 1000+ into kilo form", () => {
    expect(formatUsd(1234)).toBe("$1.2k");
  });
  it("falls back to em-dash on invalid input", () => {
    expect(formatUsd(NaN)).toBe("—");
    expect(formatUsd(-1)).toBe("—");
  });
});

describe("latencyTier", () => {
  it("green below amber threshold", () => {
    expect(latencyTier(420, 500, 800)).toBe("green");
  });
  it("amber when between thresholds", () => {
    expect(latencyTier(600, 500, 800)).toBe("amber");
  });
  it("red at or above red threshold", () => {
    expect(latencyTier(800, 500, 800)).toBe("red");
    expect(latencyTier(1200, 500, 800)).toBe("red");
  });
  it("green when latency is zero (no data yet)", () => {
    expect(latencyTier(0, 500, 800)).toBe("green");
  });
});

describe("passRateTier", () => {
  it("green at 90%+", () => {
    expect(passRateTier(0.92)).toBe("green");
    expect(passRateTier(0.9)).toBe("green");
  });
  it("amber 75-90%", () => {
    expect(passRateTier(0.8)).toBe("amber");
  });
  it("red under 75%", () => {
    expect(passRateTier(0.6)).toBe("red");
  });
  it("red on NaN (defensive)", () => {
    expect(passRateTier(NaN)).toBe("red");
  });
});

describe("signedDelta", () => {
  it("computes positive delta with leading +", () => {
    expect(signedDelta(10, 7)).toEqual({
      delta: 3,
      text: "+3",
      direction: "up",
    });
  });
  it("computes negative delta with minus sign", () => {
    expect(signedDelta(7, 10)).toEqual({
      delta: -3,
      text: "-3",
      direction: "down",
    });
  });
  it("flat when equal", () => {
    expect(signedDelta(5, 5).direction).toBe("flat");
  });
  it("treats missing values as zero", () => {
    expect(signedDelta(undefined, 4).delta).toBe(-4);
    expect(signedDelta(5, undefined).delta).toBe(5);
  });
});
