/**
 * conversationRoutes tests.
 *
 * The extractor has its own suite; what is untested until here is the BOUNDARY -- whether the
 * route actually hands the extractor the numbers that make it refuse. A coverage gate that the
 * route never reaches is a gate that does not exist, and it would look identical in the
 * extractor's own green tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/conversationFacts", () => ({
  extractConversationFacts: vi.fn(),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: vi.fn(),
}));

import { extractConversationFacts } from "../services/conversationFacts";
import { getDb } from "../db";
import { registerConversationEpisodeRoute } from "./conversationRoutes";

const extract = extractConversationFacts as unknown as ReturnType<typeof vi.fn>;
const db = getDb as unknown as ReturnType<typeof vi.fn>;

const KEY = "test-ingest-key";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

/** Captures the handler the route registers, so it can be driven with no HTTP server. */
function mount(): Handler {
  let handler: Handler | null = null;
  registerConversationEpisodeRoute({
    post: (_path: string, h: Handler) => { handler = h; },
  } as never);
  if (!handler) throw new Error("route did not register");
  return handler;
}

function fakeRes() {
  const out: { code: number; body: unknown } = { code: 200, body: null };
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  return { res, out };
}

const SEGMENTS = [{ index: 0, start: 0, end: 4, text: "front right tire keeps losing air" }];

const body = (over: Record<string, unknown> = {}) => ({
  episodeId: "ep-1", source: "eufy-office", segments: SEGMENTS,
  coveredSeconds: 85, totalSeconds: 90, ...over,
});

const okExtract = {
  ok: true, error: null, facts: [], summary: null, dropped: [], engine: "m", latencyMs: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CAMERA_INGEST_KEY = KEY;
  delete process.env.STATENOUR_SYNC_KEY;
  extract.mockResolvedValue(okExtract);
  db.mockResolvedValue({ execute: vi.fn().mockResolvedValue(undefined) });
});

describe("conversation ingest — auth fails CLOSED", () => {
  it("rejects a post with no key configured, rather than allowing it", async () => {
    // An unconfigured secret must not read as "no auth required". This endpoint receives
    // everything said at the counter.
    delete process.env.CAMERA_INGEST_KEY;
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": "" }, body: body() }, res);
    expect(out.code).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects a wrong key and never reaches the database", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": "wrong-key-xx" }, body: body() }, res);
    expect(out.code).toBe(401);
    expect(db).not.toHaveBeenCalled();
  });

  it("accepts the configured key — the positive control", async () => {
    // Without this, every test above passes on a route that rejects everything.
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(out.code).toBe(200);
  });
});

describe("conversation ingest — the coverage gate is REACHED through the route", () => {
  it("forwards coveredSeconds/totalSeconds to the extractor", async () => {
    // THE CANARY. The extractor leaves its gate OFF when either number is missing, so a
    // route that dropped them would produce confident facts from a 44%-recovered
    // transcript while the extractor's own tests stayed green.
    const h = mount();
    const { res } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ coveredSeconds: 37.4, totalSeconds: 90 }) }, res);
    expect(extract).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ coveredSeconds: 37.4, totalSeconds: 90 }),
    );
  });

  it("REFUSES a payload that omits the coverage numbers", async () => {
    // Omitting them is how a caller would silently get the ungated path. 400, not a
    // default -- a default here is a guess about audio quality.
    const h = mount();
    const { res, out } = fakeRes();
    const b = body() as Record<string, unknown>;
    delete b.coveredSeconds;
    await h({ headers: { "x-sync-key": KEY }, body: b }, res);
    expect(out.code).toBe(400);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("conversation ingest — a failed extraction is not an empty one", () => {
  it("stores FAILED when extraction could not run", async () => {
    extract.mockResolvedValue({ ...okExtract, ok: false, error: "upstream 503" });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("FAILED");
  });

  it("stores SKIPPED for a genuinely silent capture, which is a different claim", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ segments: [] }) }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("SKIPPED");
  });

  it("stores DONE when segments were transcribed", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("DONE");
  });

  it("extracts BEFORE writing, so no PENDING row is left behind on failure", async () => {
    // A two-step write would strand a PENDING row whenever extraction failed, and nothing
    // reaps those. Asserted by ordering, because the shape is invisible in the result.
    const order: string[] = [];
    extract.mockImplementation(async () => { order.push("extract"); return okExtract; });
    db.mockImplementation(async () => {
      order.push("db");
      return { execute: vi.fn().mockResolvedValue(undefined) };
    });
    const h = mount();
    const { res } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(order).toEqual(["extract", "db"]);
  });

  it("a DB outage is a 503, never a success with zero facts", async () => {
    db.mockResolvedValue(null);
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(out.code).toBe(503);
  });
});

describe("conversation ingest — the reply reports what was DROPPED", () => {
  it("returns dropped reasons alongside the stored count", async () => {
    // A caller seeing only factsStored: 0 cannot tell a quiet conversation from a
    // transcript the gate rejected, and those call for opposite responses at the shop.
    extract.mockResolvedValue({
      ...okExtract,
      dropped: [{ reason: "below threshold (transcript coverage too low)", count: 2 }],
    });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ coveredSeconds: 37.4, totalSeconds: 90 }) }, res);
    const b = out.body as { factsStored: number; dropped: { reason: string }[]; coverage: number };
    expect(b.factsStored).toBe(0);
    expect(b.dropped[0].reason).toContain("coverage");
    expect(b.coverage).toBeCloseTo(0.416, 3);
  });
});
