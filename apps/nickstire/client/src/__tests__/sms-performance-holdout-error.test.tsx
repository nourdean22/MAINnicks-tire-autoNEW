/**
 * Q-21 review P2-7 · a failed holdout read must not render as "unmeasured".
 *
 * "unmeasured" means a lane has no experiment. When the contact-experiment
 * read FAILS, the lift is unknown — the section must say so. The router used
 * to push the failure into `limitations`, which this section never renders,
 * so an outage and "no experiment" looked identical.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { buildLoopScoreboard, type LoopRow } from "@shared/loopScoreboard";

const h = vi.hoisted(() => ({ money: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    smsPerformance: {
      summary30d: { useQuery: () => ({ data: { tiers: [], replyWindowDays: 7, conversionWindowDays: 14 }, isLoading: false, isError: false }) },
      recentSends: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
      recoveredRevenue: { useQuery: () => ({ data: h.money, isLoading: false }) },
    },
  },
}));

import SmsPerformanceSection from "@/pages/admin/outreach/SmsPerformanceSection";

const loop: LoopRow = {
  loop: "winback", attempted: 10, sent: 10, undelivered: 0, replied: 1, optedOut: 0,
  paidInvoicesAfter: 2, revenueObservedCents: 50_000,
};
const board = () => buildLoopScoreboard([loop], { windowDays: 180, attributionWindowDays: 30 });

afterEach(cleanup);

describe("Money / Outcome board · holdout read failure", () => {
  it("says the holdout read FAILED and shows 'unavailable', never 'unmeasured'", () => {
    h.money = { ...board(), holdoutError: "DrizzleQueryError > Error ER_NO_SUCH_TABLE/1146" };
    render(React.createElement(SmsPerformanceSection));
    expect(screen.getByText(/Couldn't read holdout experiments/i)).toBeTruthy();
    expect(screen.getByText("unavailable")).toBeTruthy();
    expect(screen.queryByText("unmeasured")).toBeNull();
  });

  it("control: with a clean read, a lane without an experiment still reads 'unmeasured'", () => {
    h.money = { ...board(), holdoutError: null };
    render(React.createElement(SmsPerformanceSection));
    expect(screen.getByText("unmeasured")).toBeTruthy();
    expect(screen.queryByText(/Couldn't read holdout experiments/i)).toBeNull();
  });
});
