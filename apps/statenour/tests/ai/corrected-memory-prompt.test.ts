/**
 * R3-16 item 3 (review R3 wave A, finding 3) - Correct on a pinned memory kept
 * the wrong pin in the prompt shown on every turn. correctMemory supersedes the
 * old row (supersededById set) but leaves it live; the pinned-prompt query
 * filtered deletedAt only, so both versions rode every turn, the old one first
 * (the supersede write bumps updatedAt). The hot-rules query had the same shape.
 *
 * The store below honours category, deletedAt and supersededById the way the
 * database does, and the assertion is on the rendered prompt, not the query.
 */
import { describe, expect, it, vi } from "vitest";

const { memRows } = vi.hoisted(() => ({ memRows: [] as Array<Record<string, unknown>> }));

type Where = { category?: string | { in?: string[] }; deletedAt?: null; supersededById?: null; confidence?: { gte?: number } };
function matches(r: Record<string, unknown>, w: Where): boolean {
  if (typeof w.category === "string" && r.category !== w.category) return false;
  if (w.category && typeof w.category === "object" && !w.category.in?.includes(r.category as string)) return false;
  if ("deletedAt" in w && r.deletedAt !== null) return false;
  if ("supersededById" in w && r.supersededById !== null) return false;
  if (w.confidence?.gte !== undefined && (r.confidence as number) < w.confidence.gte) return false;
  return true;
}

const emptyModel = new Proxy({}, {
  get: (_t, p) => {
    if (p === "count") return vi.fn().mockResolvedValue(0);
    if (p === "findFirst") return vi.fn().mockResolvedValue(null);
    return vi.fn().mockResolvedValue([]);
  },
});

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({
    brainMemory: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async (args: { where?: Where; take?: number }) =>
        memRows
          .filter((r) => matches(r, args.where ?? {}))
          .sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime())
          .slice(0, args.take ?? Infinity),
      ),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  }, {
    get: (target, p) => (p in target ? target[p as keyof typeof target] : emptyModel),
  }),
}));

vi.mock("@/lib/utils/cache", () => ({
  cached: <T,>(_key: string, _ttl: number, load: () => Promise<T>) => load(),
}));

import { buildCommandCenterState } from "@/lib/ai/context/command-center-state";
import { nickContextFromState } from "@/lib/ai/context/nick-prime-context";
import { renderPromptV2 } from "@/lib/ai/prompt/v2/renderer";

const now = Date.now();
const mem = (o: Record<string, unknown>) => ({
  source: "manual", seenCount: 1, metadata: null, confidence: 0.9, deletedAt: null, supersededById: null,
  createdAt: new Date(now - 3600_000), ...o,
});

async function anchors(): Promise<string> {
  return renderPromptV2(nickContextFromState(await buildCommandCenterState())).anchors;
}

describe("a corrected memory leaves only the correction in the prompt", () => {
  it("pinned: the superseded pin is gone, the correction rides", async () => {
    memRows.splice(0, memRows.length,
      // the supersede write bumped updatedAt, so the OLD pin is newest
      mem({ id: "p_old", category: "pinned_user", key: "home", content: "Lives in Cleveland", supersededById: "p_new", updatedAt: new Date(now) }),
      mem({ id: "p_new", category: "pinned_user", key: "home#fix-1a2b3c4d", content: "Lives in Parma", updatedAt: new Date(now - 1000) }),
    );
    const text = await anchors();
    expect(text).toContain("Lives in Parma");
    expect(text).not.toContain("Lives in Cleveland");
  });

  it("hot rules: the superseded rule is gone, the correction rides", async () => {
    memRows.splice(0, memRows.length,
      mem({ id: "r_old", category: "identity", key: "diet", content: "Eats meat daily", supersededById: "r_new", updatedAt: new Date(now) }),
      mem({ id: "r_new", category: "identity", key: "diet#fix-1a2b3c4d", content: "Vegetarian since 2025", updatedAt: new Date(now - 1000) }),
    );
    const text = await anchors();
    expect(text).toContain("Vegetarian since 2025");
    expect(text).not.toContain("Eats meat daily");
  });

  it("brain alerts: the superseded alert is gone, the correction rides", async () => {
    memRows.splice(0, memRows.length,
      mem({ id: "a_old", category: "storage_quota_alert", key: "quota", content: "Storage at 91 percent", supersededById: "a_new", updatedAt: new Date(now) }),
      mem({ id: "a_new", category: "storage_quota_alert", key: "quota#fix-1a2b3c4d", content: "Storage at 61 percent", updatedAt: new Date(now - 1000) }),
    );
    const { risks } = renderPromptV2(nickContextFromState(await buildCommandCenterState()));
    expect(risks).toContain("Storage at 61 percent");
    expect(risks).not.toContain("Storage at 91 percent");
  });

  it("CONTROL - an uncorrected pin and rule still ride", async () => {
    memRows.splice(0, memRows.length,
      mem({ id: "p1", category: "pinned_user", key: "car", content: "Drives a 2014 Camry", updatedAt: new Date(now) }),
      mem({ id: "r1", category: "feedback", key: "tone", content: "Keep replies short", updatedAt: new Date(now) }),
    );
    const text = await anchors();
    expect(text).toContain("Drives a 2014 Camry");
    expect(text).toContain("Keep replies short");
  });
});
