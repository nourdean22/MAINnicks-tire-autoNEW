/**
 * THE CHAT MEMORY INSPECTOR READ THE ENVELOPE AS THE REPORT -- 2026-10-01.
 *
 * GET /api/brain/recall runs inside apiHandler, which answers
 * { ok, data: <RecallReport>, meta }. The inspector in chat-island.tsx did
 *
 *     const report = (await response.json()) as { hits?: ...; provenance?: ... };
 *
 * so `report.hits` and `report.provenance` were always undefined: every open
 * showed zero memories and blanked the provenance the chat stream had just
 * delivered. It also ran recall WITH side effects (lastSeen bump, metric
 * write) on whatever it displayed.
 *
 * Asserted end to end: the inspector's loader (features/chat-v2/lib/
 * inspector-recall.ts) is pointed at the REAL route inside the REAL
 * apiHandler. Only the session check, Prisma and the embedder are stubbed, so
 * the body it parses is the body production serves. The CONTROL proves the
 * route really envelopes, which is what made the old cast read nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

function row(memory_id: string) {
  return {
    memory_id,
    category: "preferences",
    key: `k:${memory_id}`,
    content: `content ${memory_id}`,
    confidence: 0.8,
    seen_count: 1,
    last_seen: new Date(),
    created_at: new Date(),
    distance: 0.2,
    source: "manual",
    created_by: "user",
  };
}

const queryRawUnsafe = vi.fn(() => Promise.resolve([row("m1"), row("m2")]));
const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
const metricCreate = vi.fn(() => Promise.resolve({}));
const requireSession = vi.fn(async () => ({ userId: "owner" }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...(a as [])),
    $executeRawUnsafe: async () => 0,
    $transaction: (fn: (tx: unknown) => unknown) =>
      Promise.resolve(fn({ $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...(a as [])), $executeRawUnsafe: async () => 0 })),
    brainMemory: { updateMany: (...a: unknown[]) => updateMany(...(a as [])), findMany: async () => [] },
    systemMetric: { create: (...a: unknown[]) => metricCreate(...(a as [])) },
    apiRequestLog: { create: async () => ({}) },
  },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));
vi.mock("@/lib/auth-guard", () => ({
  requireSession: (...a: unknown[]) => requireSession(...(a as [])),
  requireCronAuth: () => {},
  requireSyncAuth: () => {},
  requireEvidenceAuth: () => {},
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: async () => EMBEDDING }));

import { GET } from "@/app/api/brain/recall/route";
import { ServiceError } from "@/lib/utils/service-error";
import { fetchInspectorRecall } from "@/features/chat-v2/lib/inspector-recall";

const requested: string[] = [];

beforeEach(() => {
  queryRawUnsafe.mockClear();
  updateMany.mockClear();
  metricCreate.mockClear();
  requireSession.mockClear();
  requested.length = 0;
  // The browser's fetch, answered by the real route handler.
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(String(input));
    return GET(new Request(`http://x${input}`), {} as never);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the chat memory inspector reads what the recall route serves", () => {
  it("CONTROL - the route answers with an envelope, so a raw cast finds no hits", async () => {
    const res = await GET(new Request("http://x/api/brain/recall?q=taper%20plan&limit=8"), {} as never);
    const body = (await res.json()) as { ok?: boolean; hits?: unknown; data?: { hits?: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.hits).toBeUndefined();
    expect(body.data?.hits).toHaveLength(2);
  });

  it("shows the memories recall found, with their provenance", async () => {
    const report = await fetchInspectorRecall("taper plan");
    expect(report.hits.map((h) => h.id)).toEqual(["m1", "m2"]);
    expect(report.hits[0]).toMatchObject({ content: "content m1", category: "preferences" });
    expect(report.hits[0].similarity).toBeGreaterThan(0);
    expect(report.provenance).toBe("OK");
  });

  it("reads them without changing what Nick recalls", async () => {
    await fetchInspectorRecall("taper plan");
    expect(requested).toHaveLength(1);
    expect(new URL(requested[0], "http://x").searchParams.get("preview")).toBe("1");
    expect(queryRawUnsafe).toHaveBeenCalled(); // recall really ran
    expect(updateMany).not.toHaveBeenCalled();
    expect(metricCreate).not.toHaveBeenCalled();
  });

  it("a refused read throws, so the inspector says it failed instead of showing a stale list", async () => {
    requireSession.mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    await expect(fetchInspectorRecall("taper plan")).rejects.toThrow();
  });
});
