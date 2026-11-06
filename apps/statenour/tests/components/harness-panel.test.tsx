/** The bdnick Harness card. A silent PC never reads healthy; a failed read never reads empty. Red first. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { harnessStatusFromRows, harnessNodeKey, HARNESS_STALE_MS, NICK_NODE_KEY, NICK_STALE_MS } from "@/lib/services/harness-status";

type Q = { data?: unknown; isError?: boolean; isLoading?: boolean; isFetching?: boolean; error?: { message: string } | null };
const state = vi.hoisted(() => ({ q: {} as Q }));

vi.mock("@/lib/trpc/client", () => {
  const node: unknown = new Proxy(function () {}, {
    get: (_t, key: string) => {
      if (key === "useQuery") return () => ({ refetch: async () => {}, dataUpdatedAt: 0, ...state.q });
      return node;
    },
    apply: () => node,
  });
  return { trpc: node };
});

import { HarnessPanel } from "@/components/system/harness-panel";

const NOW = new Date("2026-11-05T15:00:00.000Z");
const base = {
  sha: "726f3baad4",
  ramFreeMb: 4096,
  heavy: "free",
  chrome: "free",
  sessionsActive: 3,
  worktrees: 5,
  health: { ok: false, problems: ["graphify UNKNOWN"] },
  prs: [{ number: 3546, title: "harness card", branch: "b", checks: "FAILURE" }],
  merged: [],
  mainSha: "726f3baad4",
  graph: { serverUp: true, builtCommit: "64e82ce1", behind: 2 },
  vaultGraph: { exists: true, builtAt: "2026-11-05T14:00:00.000Z" },
  sites: { bdnick: "b75472b4d9", nickstire: "726f3baad4" },
  unread: {},
};
const row = (pc: "nattynour" | "nicksmax", ageMs: number, over = {}) => ({
  nodeKey: harnessNodeKey(pc),
  lastHeartbeatAt: new Date(NOW.getTime() - ageMs),
  metadata: { harnessSnapshot: { ...base, pc, ...over } },
});
const render = (q: Q) => {
  state.q = q;
  return renderToStaticMarkup(<HarnessPanel />);
};

afterEach(() => {
  state.q = {};
});

describe("HarnessPanel", () => {
  it("shows a reporting PC, its problem, the site commits and a failing PR", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 60_000)], NOW) });
    expect(html).toContain("1 of 3 PCs reporting");
    expect(html).toContain("4.0 GB free");
    expect(html).toContain("3 sessions");
    expect(html).toContain("graphify UNKNOWN");
    expect(html).toContain("b75472b");
    expect(html).toContain("#3546");
    expect(html).toContain("failing");
  });

  it("a silent PC reads UNKNOWN with its last-seen time and shows none of its old numbers", () => {
    const html = render({ data: harnessStatusFromRows([row("nicksmax", HARNESS_STALE_MS + 8 * 60_000)], NOW) });
    expect(html).toContain("0 of 3 PCs reporting");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("Last seen");
    expect(html).toContain("Silent 23 min");
    expect(html).not.toContain("4.0 GB free");
    expect(html).not.toMatch(/healthy|all good/i);
  });

  it("a PC that never reported says so", () => {
    expect(render({ data: harnessStatusFromRows([], NOW) })).toContain("Never reported");
  });

  it("PRs nobody could read say unknown, not none", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000, { prs: null, unread: { prs: "gh failed" } })], NOW) });
    expect(html).toContain("PRs unknown");
    expect(html).not.toContain("No open PRs");
  });

  it("a measured empty PR list says no open PRs", () => {
    expect(render({ data: harnessStatusFromRows([row("nattynour", 1000, { prs: [] })], NOW) })).toContain("No open PRs");
  });

  it("a null reading on a reporting PC reads unknown, not zero", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000, { ramFreeMb: null, sessionsActive: null })], NOW) });
    expect(html).toContain("RAM unknown");
    expect(html).toContain("sessions unknown");
    expect(html).not.toContain("0.0 GB free");
    expect(html).not.toContain("0 sessions");
  });

  it("shows the graph and vault rows", () => {
    const db = { lastExportAt: "2026-11-05T12:00:00.000Z", exportedCount: 1200, liveCount: 3400, unread: {} };
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000)], NOW, db) });
    expect(html).toContain("Code graph server up");
    expect(html).toContain("built 64e82ce");
    expect(html).toContain("2 behind main");
    expect(html).toContain("1,200 of 3,400 memories exported");
    expect(html).toContain("Vault graph built");
  });

  it("missing graph and vault sources read unknown, not zero", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000, { graph: null, vaultGraph: null })], NOW) });
    expect(html).toContain("Code graph unknown");
    expect(html).toContain("Last export unknown");
    expect(html).toContain("Memory counts unknown");
    expect(html).toContain("Vault graph unknown");
  });

  it("a measured missing vault graph says not built", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000, { vaultGraph: { exists: false, builtAt: null } })], NOW) });
    expect(html).toContain("Vault graph not built");
  });

  it("shows when the picture was read", () => {
    expect(render({ data: harnessStatusFromRows([], NOW) })).toContain("Read Nov 5, 10:00 AM");
  });

  it("a failed read is marked unreadable and draws no PCs", () => {
    const html = render({ isError: true, error: { message: "boom" } });
    expect(html).toContain("data-read-failed");
    expect(html).not.toContain("PCs reporting");
  });

  it("has no action: no button that is not Retry, no form", () => {
    const html = render({ data: harnessStatusFromRows([row("nattynour", 1000)], NOW) });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).toContain("This card has no buttons");
  });

  const nick = (ageMs: number, controlKeyReady: boolean | undefined = true) => ({
    nodeKey: NICK_NODE_KEY,
    lastHeartbeatAt: new Date(NOW.getTime() - ageMs),
    version: "10f7860c70aa",
    metadata: { harnessAgent: { tools: [], controlKeyReady } },
  });

  it("Nick shows as a node with his deploy commit and whether PCs can take actions", () => {
    const html = render({ data: harnessStatusFromRows([nick(60_000)], NOW) });
    expect(html).toContain('data-harness-pc="nick"');
    expect(html).toContain("Agent on bdnick · 10f7860 · PCs can take actions");
    expect(render({ data: harnessStatusFromRows([nick(60_000, false)], NOW) })).toContain("control key not set");
  });

  it("a silent Nick reads UNKNOWN; a Nick that never reported says so", () => {
    const html = render({ data: harnessStatusFromRows([nick(NICK_STALE_MS + 60_000)], NOW) });
    expect(html).toMatch(/Nick<\/span><span[^>]*>UNKNOWN/);
    expect(html).toContain("Silent 46 min");
    expect(html).not.toContain("Agent on bdnick");
    expect(render({ data: harnessStatusFromRows([], NOW) })).toMatch(/data-harness-pc="nick"[\s\S]*Never reported/);
  });

  it("an action list that could not be read says unknown, never none", () => {
    const html = render({ data: harnessStatusFromRows([], NOW, undefined, { items: null, reason: "Harness control is not migrated yet" }) });
    expect(html).toContain("Recent actions unknown. Harness control is not migrated yet.");
    expect(html).not.toContain("No actions asked");
  });

  it("a measured empty list says none yet; listed actions show their state and exit code", () => {
    expect(render({ data: harnessStatusFromRows([], NOW, undefined, { items: [] }) })).toContain("No actions asked of the PCs yet");
    const a = {
      id: "ha_1", pc: "nattynour", action: "pc-status", state: "DONE" as const, requestedBy: "nick", reason: null,
      createdAt: NOW.toISOString(), expiresAt: NOW.toISOString(), claimedAt: null, startedAt: null, finishedAt: null,
      exitCode: 0, output: "free RAM: 1 MB", error: null,
    };
    const html = render({ data: harnessStatusFromRows([], NOW, undefined, { items: [a, { ...a, id: "ha_2", state: "EXPIRED", exitCode: null }] }) });
    expect(html).toContain("pc-status on nattynour · nick");
    expect(html).toContain("done · exit 0");
    expect(html).toContain("expired");
    expect(html).not.toContain("free RAM: 1 MB");
  });
});
