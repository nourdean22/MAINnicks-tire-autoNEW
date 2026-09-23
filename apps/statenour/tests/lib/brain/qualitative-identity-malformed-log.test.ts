/**
 * tests/lib/brain/qualitative-identity-malformed-log.test.ts · 2026-09-02.
 *
 * A SILENT FALL-THROUGH THAT IS NOT CHEAP.
 *
 * `loadQualitativeIdentity` parsed the stored `qualitative_identity/current`
 * blob inside a `try` whose `catch` was a bare `// fall through`. No log, no
 * counter, nothing. The fall-through runs `computeQualitativeIdentity()`,
 * which scans 60 days of reflections plus chat_importance and WRITES two
 * BrainMemory rows — so a single malformed blob turned every cache miss on
 * a hot /chat path into a full recompute with no trace anywhere.
 *
 * The state is self-healing (the recompute rewrites the row), which is
 * exactly why it needed a log: a defect that repairs itself leaves nothing
 * behind to notice, so the only symptom was latency nobody could attribute.
 *
 * These pin the behaviour on both sides of the branch: malformed ⇒ logged
 * AND still recovered; valid ⇒ parsed AND silent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidate } from "@/lib/utils/cache";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  reflection: { findMany: vi.fn() },
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory, reflection: mocks.reflection },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: mocks.logError }));
import { loadQualitativeIdentity } from "@/lib/brain/qualitative-identity";

// Mirrors CACHE_KEY in lib/brain/qualitative-identity.ts — the same
// documentation-as-code convention as the cache test next door.
const CACHE_KEY = "qualitative_identity_current";

const STORED_IDENTITY = {
  values: [
    {
      text: "speed over politeness",
      manual: false,
      evidence_ids: [],
      confidence: 0.9,
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ],
  fears: [],
  operating_style: [],
  rhythms: [],
  red_lines: [],
  computed_at: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidate(CACHE_KEY);
  // computeQualitativeIdentity's inputs — empty, so the recompute is cheap
  // but still observable through the upserts it writes.
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.reflection.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
  mocks.brainMemory.update.mockResolvedValue({});
});

describe("loadQualitativeIdentity · a malformed stored blob is logged, not swallowed", () => {
  it("logs the parse failure before falling through to a full recompute", async () => {
    mocks.brainMemory.findUnique.mockResolvedValue({ content: "{not json" });

    await loadQualitativeIdentity();

    expect(mocks.logError).toHaveBeenCalledWith(
      "brain.qualitative-identity",
      expect.any(Error),
      expect.objectContaining({
        fn: "loadQualitativeIdentity",
        key: "current",
        action: "recompute",
      }),
      "warn",
    );
  });

  it("still recovers — the recompute runs and rewrites the row", async () => {
    mocks.brainMemory.findUnique.mockResolvedValue({ content: "{not json" });

    const identity = await loadQualitativeIdentity();

    // Behaviour preserved: the caller gets a usable identity, and the two
    // upserts (current + history:YYYY-MM-DD) are what makes it self-healing
    // — and what makes the silent version expensive.
    expect(identity).toHaveProperty("values");
    expect(identity).toHaveProperty("red_lines");
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(2);
  });

  it("CONTROL · a valid blob is parsed, with no log and no recompute", async () => {
    // Without this, logging unconditionally — or recomputing every call —
    // would satisfy both assertions above while wrecking the hot path.
    mocks.brainMemory.findUnique.mockResolvedValue({
      content: JSON.stringify(STORED_IDENTITY),
    });

    const identity = await loadQualitativeIdentity();

    expect(identity.values[0].text).toBe("speed over politeness");
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("CONTROL · a missing row recomputes silently — absence is not corruption", async () => {
    mocks.brainMemory.findUnique.mockResolvedValue(null);

    await loadQualitativeIdentity();

    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(2);
  });
});
