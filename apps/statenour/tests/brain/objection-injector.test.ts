/**
 * AG-30 · objection-injector contract tests (mocked prisma).
 *
 * Locks: strong-objection retrieval scoped to ONE conversation within
 * 24h, the severity≥2 + foundFlaw gate, once-per-conversation dedup,
 * the block wording, and fail-closed behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import {
  findRelevantObjections,
  buildObjectionBlock,
} from "@/lib/brain/objection-injector";

const CONV = "conv_123";

function objectionRow(opts: {
  key?: string;
  severity?: number;
  foundFlaw?: boolean;
  objection?: string;
}) {
  const severity = opts.severity ?? 3;
  const flaw = opts.foundFlaw ?? true;
  return {
    key: opts.key ?? "objection_msg1",
    content: `[Sev ${severity}${flaw ? " · flaw" : ""}] ${opts.objection ?? "The margin math ignores the alignment-rack downtime."}`,
    createdAt: new Date(),
    metadata: { conversationId: CONV, severity, foundFlaw: flaw },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "log1" });
});

describe("findRelevantObjections", () => {
  it("returns the strong objection for this conversation and writes the dedup marker", async () => {
    mockFindMany.mockResolvedValue([objectionRow({})]);
    const hit = await findRelevantObjections({ conversationId: CONV });
    expect(hit).not.toBeNull();
    expect(hit!.objection).toBe("The margin math ignores the alignment-rack downtime.");
    expect(hit!.severity).toBe(3);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const created = mockCreate.mock.calls[0][0] as { data: { category: string; key: string } };
    expect(created.data.category).toBe("objection_injection_log");
    expect(created.data.key).toBe(`${CONV}:objection_msg1`);
  });

  it("ignores weak objections (severity < 2 or no flaw)", async () => {
    mockFindMany.mockResolvedValue([
      objectionRow({ severity: 1 }),
      objectionRow({ key: "objection_msg2", foundFlaw: false }),
    ]);
    expect(await findRelevantObjections({ conversationId: CONV })).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("suppresses an objection already surfaced in this conversation", async () => {
    mockFindMany.mockResolvedValue([objectionRow({})]);
    mockFindUnique.mockResolvedValue({ id: "already" });
    expect(await findRelevantObjections({ conversationId: CONV })).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null without a conversationId (no cross-conversation leakage)", async () => {
    expect(await findRelevantObjections({ conversationId: null })).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("fails closed when the DB throws", async () => {
    mockFindMany.mockRejectedValue(new Error("neon down"));
    expect(await findRelevantObjections({ conversationId: CONV })).toBeNull();
  });
});

describe("buildObjectionBlock", () => {
  it("wraps the objection with raise-once framing", () => {
    const block = buildObjectionBlock({
      key: "objection_msg1",
      objection: "The margin math ignores the alignment-rack downtime.",
      severity: 3,
      createdAt: new Date().toISOString(),
    });
    expect(block).toContain("OPEN COUNTER-VIEW");
    expect(block).toContain("raise it ONCE");
    expect(block).toContain("stay silent");
    expect(block).toContain("alignment-rack downtime");
  });
});
