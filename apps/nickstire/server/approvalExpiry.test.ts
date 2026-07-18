/**
 * Durable approval semantics (0087) — approvals expire and are enforced at
 * execution time; a stale approval must not authorize a publish.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { APPROVAL_TTL_HOURS, verifyApprovalRecord } from "./services/contentApprovals";

afterEach(() => vi.restoreAllMocks());

function dbWithApproval(row: Record<string, unknown> | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
      }),
    }),
  } as never;
}

const baseApproval = {
  id: "appr_1",
  inventoryId: "inv_1",
  version: 3,
  briefHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", // sha256("test")
  mediaHash: "mocked_media_hash_32chars_long_hash",
  expiresAt: null as Date | null,
};

const args = { inventoryId: "inv_1", version: 3, briefJson: "test", mediaUrls: ["mock://video.mp4"] };

describe("verifyApprovalRecord expiry", () => {
  it("an EXPIRED approval refuses with its own distinct reason — before any hash work", async () => {
    const verdict = await verifyApprovalRecord(dbWithApproval({ ...baseApproval, expiresAt: new Date(Date.now() - 60_000) }), args);
    expect(verdict).toEqual({ ok: false, reason: "expired" });
  });

  it("a live approval within TTL passes hash verification", async () => {
    const verdict = await verifyApprovalRecord(dbWithApproval({ ...baseApproval, expiresAt: new Date(Date.now() + 3600_000) }), args);
    expect(verdict).toMatchObject({ ok: true });
  });

  it("legacy pre-0087 rows (null expiry) remain valid for backward compatibility", async () => {
    const verdict = await verifyApprovalRecord(dbWithApproval({ ...baseApproval, expiresAt: null }), args);
    expect(verdict).toMatchObject({ ok: true });
  });

  it("hash mismatches still refuse independent of expiry", async () => {
    const verdict = await verifyApprovalRecord(
      dbWithApproval({ ...baseApproval, expiresAt: new Date(Date.now() + 3600_000), briefHash: "different" }),
      args,
    );
    expect(verdict).toEqual({ ok: false, reason: "brief_mismatch" });
  });

  it("the TTL constant is a sane bounded window", () => {
    expect(APPROVAL_TTL_HOURS).toBeGreaterThanOrEqual(24);
    expect(APPROVAL_TTL_HOURS).toBeLessThanOrEqual(24 * 7);
  });
});
