/** A harness PC row must not read as the live agent on the Command Deck. Red before the where clause. */
import { describe, it, expect, vi } from "vitest";

const row = { nodeKey: "harness:nattynour", lastHeartbeatAt: new Date(), status: "READY", label: "NattyNour" };
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, table) =>
        table === "runnerNode"
          ? { findFirst }
          : { findFirst: async () => null, findMany: async () => [], groupBy: async () => [], count: async () => 0 },
    },
  ),
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));
vi.mock("@/lib/services/dashboard", () => ({ getDailyCommandBrief: async () => ({}) }));
vi.mock("@/lib/services/runner-state", () => ({ getNourStatusSnapshot: async () => ({ services: {} }) }));
vi.mock("@/lib/services/bridge", () => ({ fetchShopSnapshot: async () => null }));
vi.mock("@/lib/auth-guard", () => ({ requireSession: async () => undefined }));
vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: async () => [] }));

import { GET } from "@/app/api/command/data/route";

describe("/api/command/data", () => {
  it("does not offer a harness row as the latest runner", async () => {
    findFirst.mockImplementation(async (args: { where?: { nodeKey?: { not?: { startsWith?: string } } } }) => {
      const prefix = args.where?.nodeKey?.not?.startsWith;
      return prefix && row.nodeKey.startsWith(prefix) ? null : row;
    });
    const res = await GET(new Request("http://localhost/api/command/data"));
    const body = (await res.json()) as { data: { system?: { agentOnline?: boolean } } };
    expect(findFirst).toHaveBeenCalled();
    expect(JSON.stringify(body)).toContain("agentOnline");
    expect(JSON.stringify(body)).toMatch(/"agentOnline":false/);
  });
});
