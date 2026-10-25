/**
 * Alt lanes register in the active-stream registry (audit 04-F8, 2026-10-10).
 *
 * The streamText path registers its turn (route.ts); the buffered alt lanes
 * (deep reasoning, regen / self-consistency / evidence pre-flush) did not.
 * A reconnect during an alt-lane turn therefore found the PREVIOUS turn's
 * lingering "complete" record and replayed the previous reply.
 *
 *   · trackActiveStream registers now and completes only after the lane's
 *     persist RESOLVES (a failed persist leaves the row to self-expire,
 *     the same rule route.ts follows);
 *   · every alt-lane response is preceded by that registration and every
 *     alt-lane persist is handed to it (source contract: runAlternatePaths
 *     has no harness, same shape as receipt-verification-join.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mockUpsert = vi.fn(async () => ({}));
const mockUpdate = vi.fn(async () => ({}));
const mockFindUnique = vi.fn(async () => ({ id: "row", metadata: { status: "active", traceId: "T9" } }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: (a: never) => mockUpsert(a),
      update: (a: never) => mockUpdate(a),
      findUnique: (a: never) => mockFindUnique(a),
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { trackActiveStream } from "@/lib/services/chat/active-stream";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("trackActiveStream", () => {
  it("registers the turn with ITS traceId immediately, and completes after the persist resolves", async () => {
    let resolvePersist!: () => void;
    const persisted = new Promise<void>((r) => (resolvePersist = r));
    const done = trackActiveStream("c1", "T9");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const meta = (mockUpsert.mock.calls[0] as unknown as [{ create: { metadata: { traceId: string; status: string } } }])[0]
      .create.metadata;
    expect(meta).toMatchObject({ status: "active", traceId: "T9" });

    done(persisted);
    await flush();
    expect(mockUpdate, "completed before the persist landed").not.toHaveBeenCalled();
    resolvePersist();
    await flush();
    await flush();
    const data = (mockUpdate.mock.calls[0] as unknown as [{ data: { metadata: { status: string } } }])[0].data;
    expect(data.metadata.status).toBe("complete");
  });

  it("a REJECTED persist never marks the turn complete", async () => {
    const done = trackActiveStream("c1", "T9");
    done(Promise.reject(new Error("persist failed")));
    await flush();
    await flush();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("alternate-paths wiring (source contract)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/ai/chat/alternate-paths.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("every alt-lane response is registered and every alt-lane persist is tracked", () => {
    const responses = src.match(/return buildChatResponse\(/g) ?? [];
    const persists = src.match(/__altPersist\(\{/g) ?? [];
    const registrations = src.match(/trackActiveStream\(convId, traceId\)/g) ?? [];
    const tracked = src.match(/__altTurnDone\?\.\(/g) ?? [];
    // POSITIVE CONTROL: the stripper left the code it must see.
    expect(responses.length).toBeGreaterThanOrEqual(2);
    expect(persists.length).toBe(responses.length);
    // 2026-10-25: ONE registration, before any lane generates, so the turn is in the registry for
    // the whole generation (a stall reattach reads it); behaviour pinned in alternate-paths-budget.test.ts.
    expect(registrations.length).toBe(1);
    expect(src.indexOf("trackActiveStream(convId, traceId)")).toBeLessThan(src.indexOf("if (multiAgentOn)"));
    expect(tracked.length).toBe(persists.length);
  });
});
