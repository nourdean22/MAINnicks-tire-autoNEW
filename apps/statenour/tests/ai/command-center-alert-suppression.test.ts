/**
 * UI v3 W5b, consumer 3: Nick's command-center state (lib/ai/context/command-center-state.ts) lists
 * brain alerts in his context. It kept its own copy of the category list and honoured neither the
 * W3 category mute nor a dismissal, so Nick would still raise an alert Nour had dismissed.
 * It now reads the shared suppression (lib/brain/alert-suppression.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertDismissKey } from "@/lib/brain/alert-lanes";

const h = vi.hoisted(() => {
  const state = {
    suppression: [] as { category: string; key: string }[],
    alerts: [] as { category: string; key: string; content: string; createdAt: Date }[],
  };
  const brainMemory = {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    groupBy: vi.fn(async () => []),
    findMany: vi.fn(async (a: { where: { category: unknown } }) => {
      const c = a.where.category as { in?: string[] } | string;
      if (typeof c === "object" && c?.in) {
        if (c.in.includes("alert_dismiss") || c.in.includes("alert_mute")) {
          return state.suppression.filter((r) => c.in!.includes(r.category));
        }
        return state.alerts.filter((r) => c.in!.includes(r.category));
      }
      return [];
    }),
  };
  const emptyModel = new Proxy({}, {
    get: (_t, p) => {
      if (p === "count") return vi.fn().mockResolvedValue(0);
      if (p === "findFirst" || p === "findUnique") return vi.fn().mockResolvedValue(null);
      return vi.fn().mockResolvedValue([]);
    },
  });
  const prisma = new Proxy({ brainMemory, $queryRaw: vi.fn().mockResolvedValue([]) } as Record<string, unknown>, {
    get: (t, p: string) => (p in t ? t[p] : emptyModel),
  });
  return { state, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/utils/cache", () => ({
  cached: <T,>(_key: string, _ttl: number, load: () => Promise<T>) => load(),
}));

import { buildCommandCenterState } from "@/lib/ai/context/command-center-state";

beforeEach(() => {
  h.state.suppression = [];
  h.state.alerts = [
    { category: "storage_quota_alert", key: "neon-a", content: "Storage quota warning A", createdAt: new Date() },
    { category: "storage_quota_alert", key: "neon-b", content: "Storage quota warning B", createdAt: new Date() },
  ];
});

const contents = async () => (await buildCommandCenterState()).risks.brainAlerts.map((a) => a.content);

describe("command-center brainAlerts honour the shared suppression", () => {
  it("a dismissed alert is absent; an undismissed one in the same category is present", async () => {
    h.state.suppression = [{ category: "alert_dismiss", key: alertDismissKey("storage_quota_alert", "neon-a") }];
    const got = (await contents()).join("\n");
    expect(got).not.toContain("warning A");
    expect(got).toContain("warning B");
  });

  it("a muted category is absent", async () => {
    h.state.suppression = [{ category: "alert_mute", key: "storage_quota_alert" }];
    const got = (await contents()).join("\n");
    expect(got).not.toContain("Storage quota warning");
  });

  it("CONTROL: with nothing suppressed both alerts reach Nick", async () => {
    const got = (await contents()).join("\n");
    expect(got).toContain("warning A");
    expect(got).toContain("warning B");
  });
});
