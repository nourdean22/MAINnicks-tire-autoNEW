/** A harness PC row must never read as the live runner. Red before the where clause in runner-state.ts. */
import { describe, it, expect, vi } from "vitest";

const rows = [
  { nodeKey: "harness:nattynour", label: "NattyNour", status: "READY", lastHeartbeatAt: new Date("2026-11-05T15:00:00Z"), version: null, metadata: {} },
];
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig<typeof import("node:fs/promises")>()),
  readFile: vi.fn(async () => {
    throw new Error("no local snapshot");
  }),
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSnapshot: { findUnique: async () => null },
    serviceHealth: { findMany: async () => [] },
    runnerNode: { findFirst },
    captureInboxItem: { count: async () => 0 },
  },
}));

import { getSystemHealthSnapshot } from "@/lib/services/runner-state";

describe("getSystemHealthSnapshot", () => {
  it("does not offer a harness row as the runner", async () => {
    findFirst.mockImplementation(async (args: { where?: { nodeKey?: { not?: { startsWith?: string } } } }) => {
      const prefix = args.where?.nodeKey?.not?.startsWith;
      return rows.find((r) => !prefix || !r.nodeKey.startsWith(prefix)) ?? null;
    });
    const snapshot = await getSystemHealthSnapshot();
    expect((snapshot as { services: { runner: { status: string; detail: string } } }).services.runner.detail).toMatch(/No runner heartbeat/);
  });
});
