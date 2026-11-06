/** The admin Harness card. A silent PC never reads healthy; a failed read never reads empty. Red first. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; refetch?: () => void };
const state = vi.hoisted(() => ({ q: {} as Q }));

vi.mock("@/lib/trpc", () => ({
  trpc: { nourOsBridge: { harnessStatus: { useQuery: () => ({ refetch: () => {}, ...state.q }) } } },
}));

import HarnessCard from "@/pages/admin/settings/HarnessCard";

const reporting = {
  key: "nattynour",
  label: "NattyNour",
  state: "reporting",
  lastSeenAt: "2026-11-05T14:58:00.000Z",
  reason: null,
  sha: "726f3baad4",
  ramFreeMb: 4096,
  heavy: "free",
  chrome: "free",
  sessionsActive: 3,
  worktrees: 5,
  health: { ok: false, problems: ["graphify UNKNOWN"] },
  unread: {},
};
const silent = {
  ...reporting,
  key: "nicksmax",
  label: "NicksMax",
  state: "unknown",
  reason: "Silent 23 min",
  ramFreeMb: null,
  sessionsActive: null,
  health: null,
};
const status = (over = {}) => ({
  generatedAt: "2026-11-05T15:00:00.000Z",
  reporting: 1,
  pcs: [reporting, silent],
  prs: { items: [{ number: 3546, title: "harness card", branch: "b", checks: "FAILURE" }], from: "NattyNour", asOf: "x" },
  prsReason: null,
  merged: null,
  mainSha: "726f3baad4",
  graph: { serverUp: true, builtCommit: "64e82ce1", behind: 2, from: "NattyNour", asOf: "x" },
  graphReason: null,
  vault: { lastExportAt: "2026-11-05T12:00:00.000Z", exportedCount: null, liveCount: 3400, graph: { exists: false, builtAt: null }, unread: {} },
  sites: { bdnick: { commit: "b75472b4d9", asOf: "x" }, nickstire: null },
  ...over,
});

afterEach(() => {
  state.q = {};
});

describe("HarnessCard", () => {
  it("shows a reporting PC, a silent PC as UNKNOWN with last seen, sites and a failing PR", () => {
    state.q = { data: status() };
    render(<HarnessCard />);
    expect(screen.getByText("1 of 2 PCs reporting")).toBeTruthy();
    expect(screen.getByText(/4\.0 GB free/)).toBeTruthy();
    expect(screen.getByText("graphify UNKNOWN")).toBeTruthy();
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
    expect(screen.getByText(/Last seen.*Silent 23 min/)).toBeTruthy();
    expect(screen.getByText(/bdnick b75472b/)).toBeTruthy();
    expect(screen.getByText(/nickstire unknown/)).toBeTruthy();
    expect(screen.getByText(/#3546/)).toBeTruthy();
    expect(screen.getByText("failing")).toBeTruthy();
  });

  it("PRs nobody could read say unknown; an empty list says none", () => {
    state.q = { data: status({ prs: null, prsReason: "No reporting PC could read GitHub" }) };
    const { unmount } = render(<HarnessCard />);
    expect(screen.getByText(/PRs unknown/)).toBeTruthy();
    expect(screen.queryByText(/No open PRs/)).toBeNull();
    unmount();
    state.q = { data: status({ prs: { items: [], from: "NattyNour", asOf: "x" } }) };
    render(<HarnessCard />);
    expect(screen.getByText(/No open PRs/)).toBeTruthy();
  });

  it("shows the graph and vault rows; a missing count reads unknown", () => {
    state.q = { data: status() };
    render(<HarnessCard />);
    expect(screen.getByText(/Code graph server up · built 64e82ce · 2 behind main/)).toBeTruthy();
    expect(screen.getByText(/Memory counts unknown/)).toBeTruthy();
    expect(screen.getByText(/Vault graph not built/)).toBeTruthy();
  });

  it("no graph source reads unknown with its reason", () => {
    state.q = { data: status({ graph: null, graphReason: "No reporting PC has the code graph" }) };
    render(<HarnessCard />);
    expect(screen.getByText(/Code graph unknown. No reporting PC has the code graph/)).toBeTruthy();
  });

  it("shows when the picture was read", () => {
    state.q = { data: status() };
    render(<HarnessCard />);
    expect(screen.getByText(/^Read Nov 5, 10:00 AM/)).toBeTruthy();
  });

  it("a failed refresh over old data says so, with the time of the last good read", () => {
    state.q = { data: status(), isError: true };
    render(<HarnessCard />);
    expect(screen.getByText(/Last refresh failed.*state unknown.*Nov 5, 10:00 AM/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("a failed read says unknown and draws no PCs", () => {
    state.q = { isError: true };
    render(<HarnessCard />);
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByText(/PCs reporting/)).toBeNull();
  });

  it("offers no action on the data view", () => {
    state.q = { data: status() };
    const { container } = render(<HarnessCard />);
    expect(container.querySelector("button, form, a")).toBeNull();
    expect(screen.getByText(/This card has no buttons/)).toBeTruthy();
  });

  it("Nick shows as a node: reporting with his commit, silent as UNKNOWN, missing as unknown (never fine)", () => {
    const nick = { state: "reporting", lastSeenAt: "2026-11-05T14:50:00.000Z", reason: null, version: "10f7860c70aa", controlKeyReady: true };
    state.q = { data: status({ nick }) };
    const first = render(<HarnessCard />);
    expect(screen.getByText(/Agent on bdnick · 10f7860 · PCs can take actions/)).toBeTruthy();
    first.unmount();

    state.q = { data: status({ nick: { ...nick, state: "unknown", reason: "Silent 50 min" } }) };
    const second = render(<HarnessCard />);
    expect(screen.getByText(/Silent 50 min/)).toBeTruthy();
    expect(screen.queryByText(/Agent on bdnick/)).toBeNull();
    second.unmount();

    state.q = { data: status() };
    render(<HarnessCard />);
    expect(screen.getByText(/does not report Nick yet/)).toBeTruthy();
  });
});
