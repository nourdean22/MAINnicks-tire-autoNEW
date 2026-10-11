/**
 * R3-16 item 3 sweep - correctMemory supersedes the old row (supersededById
 * set) but leaves it live, so every reader that filters deletedAt alone shows
 * BOTH versions as current. The prompt/page readers fixed here:
 *   - listPins (the /pins page and the listPins tool)
 *   - /api/ai/plan-day's "High-priority brain context" prompt block
 *   - the stale-pin suggestion in buildNickSuggestions
 *   - semanticSearch's in-memory fallback lane (runs during a pgvector outage)
 *
 * The store honours deletedAt / supersededById / category / OR the way the
 * database does, so a reader that omits the filter gets the superseded row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, aiCalls } = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  aiCalls: [] as Array<Array<{ role: string; content: string }>>,
}));

type W = Record<string, unknown>;
function match(r: Record<string, unknown>, w: W): boolean {
  for (const [k, c] of Object.entries(w ?? {})) {
    if (k === "OR") { if (!(c as W[]).some((x) => match(r, x))) return false; continue; }
    if (k === "AND") { if (!(c as W[]).every((x) => match(r, x))) return false; continue; }
    const v = r[k] as never;
    if (c === null) { if (v !== null && v !== undefined) return false; continue; }
    if (typeof c === "object" && !(c instanceof Date)) {
      const o = c as { in?: unknown[]; notIn?: unknown[]; lt?: Date; gt?: Date; gte?: number | Date };
      if (o.in && !o.in.includes(v)) return false;
      if (o.notIn && o.notIn.includes(v)) return false;
      if (o.lt !== undefined && !(v < o.lt)) return false;
      if (o.gt !== undefined && !(v > o.gt)) return false;
      if (o.gte !== undefined && !(v >= o.gte)) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}

const emptyModel = new Proxy({}, {
  get: (_t, p) => {
    if (p === "count") return vi.fn(async () => 0);
    if (p === "findFirst" || p === "findUnique") return vi.fn(async () => null);
    return vi.fn(async () => []);
  },
});

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({
    brainMemory: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async (a: { where?: W; take?: number; orderBy?: Record<string, string> }) =>
        rows
          .filter((r) => match(r, a.where ?? {}))
          .sort((x, y) => (y.updatedAt as Date).getTime() - (x.updatedAt as Date).getTime())
          .slice(0, a.take ?? Infinity),
      ),
    },
    vectorEmbedding: {
      findMany: vi.fn(async () =>
        rows.map((r) => ({ sourceId: r.id, sourceType: "brain_memory", content: r.content, embedding: JSON.stringify(new Array(8).fill(0.1)) })),
      ),
    },
  }, {
    get: (target, p) => (p in target ? target[p as keyof typeof target] : emptyModel),
  }),
}));

vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: vi.fn(async () => false),
  knnSearch: vi.fn(async () => null),
  assertSafeVectorLiteral: vi.fn(),
  padToVectorDim: (v: number[]) => v,
  vectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn(async () => new Array(8).fill(0.1)) }));
vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn(async () => ({ user: { id: "nour" } })) }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: vi.fn(() => null) }));
vi.mock("@/lib/automotive/industry-monitor", () => ({ recallIndustryIntel: vi.fn(async () => []) }));
vi.mock("@/lib/ai/style-adapter", () => ({ applyOperatorStyle: vi.fn(async (s: string) => s) }));
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: vi.fn(async (_meta: unknown, messages: Array<{ role: string; content: string }>) => {
    aiCalls.push(messages);
    return { content: '{"period":"Today","theme":"t","blocks":[]}', model: "m", provider: "p" };
  }),
}));
vi.mock("@/lib/brain/suggestion-loop", () => ({ getDismissedSuggestionIds: vi.fn(async () => new Set<string>()) }));
vi.mock("@/lib/services/leads", () => ({ getUrgentLeads: vi.fn(async () => []) }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => undefined) }));

const DAY = 86_400_000;
const now = Date.now();
const mem = (o: Record<string, unknown>) => ({
  category: "pinned_user", source: "manual", confidence: 1, seenCount: 1, metadata: null,
  deletedAt: null, supersededById: null, createdAt: new Date(now - 60 * DAY), ...o,
});
const OLD = mem({ id: "p_old", key: "home", content: "Lives in Cleveland", supersededById: "p_new", updatedAt: new Date(now - 40 * DAY) });
const NEW = mem({ id: "p_new", key: "home#fix-1a2b3c4d", content: "Lives in Parma", updatedAt: new Date(now - 41 * DAY) });
const FORGOTTEN = mem({ id: "p_gone", key: "car", content: "Drives a Pinto", deletedAt: new Date(now - DAY), updatedAt: new Date(now - DAY) });

beforeEach(() => {
  rows.splice(0, rows.length, OLD, NEW, FORGOTTEN);
  aiCalls.length = 0;
});

describe("superseded memories are not shown as current", () => {
  it("listPins: only the correction is listed", async () => {
    const { listPins } = await import("@/lib/services/pins");
    const out = (await listPins()) as { pins: Array<{ content: string }>; count: number };
    const text = out.pins.map((p) => p.content);
    expect(text).toContain("Lives in Parma");
    expect(text).not.toContain("Lives in Cleveland");
    expect(out.count).toBe(1);
  });

  it("plan-day: the prompt carries the correction, not the superseded or forgotten pin", async () => {
    const { POST } = await import("@/app/api/ai/plan-day/route");
    const res = await POST(new Request("http://x/api/ai/plan-day", { method: "POST", body: JSON.stringify({ dayLabel: "today" }) }));
    expect(res.status).toBe(200);
    const user = aiCalls[0]?.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("Lives in Parma");
    expect(user).not.toContain("Lives in Cleveland");
    expect(user).not.toContain("Drives a Pinto");
  });

  it("stale-pin suggestion: names the correction, never the superseded pin", async () => {
    const { buildNickSuggestions } = await import("@/lib/services/nick-suggestions");
    const view = (await buildNickSuggestions()) as unknown as { suggestions: Array<{ kind: string; label: string; sourceContext?: { pinId?: string } }> };
    const stale = view.suggestions.find((s) => s.kind === "stale-pin");
    expect(stale?.sourceContext?.pinId).toBe("p_new");
    expect(stale?.label).not.toContain("Cleveland");
  });

  it("semanticSearch fallback lane: the superseded memory is not recalled", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("where does nour live", 10, ["brain_memory"]);
    const ids = hits.map((h) => h.sourceId);
    expect(ids).toContain("p_new");
    expect(ids).not.toContain("p_old");
  });
});
