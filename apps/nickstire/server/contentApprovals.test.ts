import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

/**
 * Non-reel publish provenance (audit WS3). Reels published only what a human
 * hash-approved; every other format published whatever URLs the row carried,
 * unchecked. These tests pin the shared hash engine and the cron publisher's
 * integrity gate.
 */
const { approvalRows } = vi.hoisted(() => ({ approvalRows: [] as unknown[] }));

vi.mock("./lib/db-helper", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(approvalRows);
  const database = { select: () => chain, insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }) };
  return { db: async () => database, dbTyped: async () => database, requireDb: async () => database };
});

import { computeMediaHash, computeBriefHash, verifyApprovalRecord } from "./services/contentApprovals";
import { dbTyped } from "./lib/db-helper";

const IMG_A = Buffer.from("image-bytes-A");
const IMG_B = Buffer.from("image-bytes-B");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function stubFetchByUrl(map: Record<string, Buffer>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = map[url];
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  }));
}

beforeEach(() => {
  approvalRows.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeMediaHash", () => {
  it("hashes a single URL to sha256 of its bytes", async () => {
    stubFetchByUrl({ "https://cdn/a.jpg": IMG_A });
    expect(await computeMediaHash(["https://cdn/a.jpg"])).toBe(sha(IMG_A));
  });

  it("treats carousel ORDER as part of the approval — reordered slides hash differently", async () => {
    stubFetchByUrl({ "https://cdn/a.jpg": IMG_A, "https://cdn/b.jpg": IMG_B });
    const ab = await computeMediaHash(["https://cdn/a.jpg", "https://cdn/b.jpg"]);
    const ba = await computeMediaHash(["https://cdn/b.jpg", "https://cdn/a.jpg"]);
    expect(ab).not.toBe(ba);
  });

  it("uses the reel sentinel for mock:// URLs without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await computeMediaHash(["mock://x"])).toBe("mocked_media_hash_32chars_long_hash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly when media cannot be downloaded — no hash, no silent pass", async () => {
    stubFetchByUrl({});
    await expect(computeMediaHash(["https://cdn/missing.jpg"])).rejects.toThrow(/HTTP 404/);
  });
});

describe("verifyApprovalRecord", () => {
  const briefJson = JSON.stringify({ caption: "approved copy" });

  it("returns no_record when nothing was approved at that version", async () => {
    const d = (await dbTyped())!;
    const res = await verifyApprovalRecord(d, { inventoryId: "x", version: 1, briefJson, mediaUrls: ["mock://a"] });
    expect(res).toEqual({ ok: false, reason: "no_record" });
  });

  it("detects content edited after approval (brief_mismatch)", async () => {
    approvalRows.push({ briefHash: computeBriefHash(briefJson), mediaHash: "mocked_media_hash_32chars_long_hash" });
    const d = (await dbTyped())!;
    const res = await verifyApprovalRecord(d, {
      inventoryId: "x", version: 1,
      briefJson: JSON.stringify({ caption: "EDITED copy" }),
      mediaUrls: ["mock://a"],
    });
    expect(res).toEqual({ ok: false, reason: "brief_mismatch" });
  });

  it("detects media swapped after approval (media_mismatch)", async () => {
    stubFetchByUrl({ "https://cdn/swapped.jpg": IMG_B });
    approvalRows.push({ briefHash: computeBriefHash(briefJson), mediaHash: sha(IMG_A) });
    const d = (await dbTyped())!;
    const res = await verifyApprovalRecord(d, { inventoryId: "x", version: 1, briefJson, mediaUrls: ["https://cdn/swapped.jpg"] });
    expect(res).toEqual({ ok: false, reason: "media_mismatch" });
  });

  it("passes when brief and media are byte-identical to the approval", async () => {
    stubFetchByUrl({ "https://cdn/a.jpg": IMG_A });
    approvalRows.push({ briefHash: computeBriefHash(briefJson), mediaHash: sha(IMG_A) });
    const d = (await dbTyped())!;
    const res = await verifyApprovalRecord(d, { inventoryId: "x", version: 1, briefJson, mediaUrls: ["https://cdn/a.jpg"] });
    expect(res).toMatchObject({ ok: true });
  });
});
