/**
 * Claim-level evidence records (directive milestone 6) — structured, claim-
 * linked, snapshot-hashed where fetchable, honestly not_evaluated for
 * entailment, and expiring.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveEvidenceRecords, isEvidenceRecordLive, EVIDENCE_TTL_DAYS } from "./services/evidenceRecords";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("resolveEvidenceRecords", () => {
  it("public-registry handles become claim-linked records with deterministic ids and honest entailment", async () => {
    const claim = "Cold cuts battery cranking power roughly in half";
    const a = await resolveEvidenceRecords(["NHTSA tire pressure guidance", "made up nonsense"], claim, { snapshot: false });
    const b = await resolveEvidenceRecords(["NHTSA tire pressure guidance"], claim, { snapshot: false });

    expect(a.rejected).toEqual(["made up nonsense"]);
    expect(a.records).toHaveLength(1);
    const rec = a.records[0];
    expect(rec.id).toBe(b.records[0].id); // deterministic per (handle, claim)
    expect(rec.sourceType).toBe("public_registry");
    expect(rec.claim).toBe(claim);
    expect(rec.assertion).toContain("nhtsa.gov");
    expect(rec.entailment).toBe("not_evaluated"); // never fabricated
    expect(rec.snapshotStatus).toBe("not_attempted");
    const ttlDays = (new Date(rec.expiresAt).getTime() - new Date(rec.retrievedAt).getTime()) / 86_400_000;
    expect(Math.round(ttlDays)).toBe(EVIDENCE_TTL_DAYS.public_family);
  });

  it("snapshot: a fetchable source is content-hashed; a bot-blocked source records fetch_blocked with reduced confidence", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      String(url).includes("nhtsa.gov")
        ? Promise.resolve({ ok: false, status: 403 } as Response)
        : Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode("page content").buffer) } as unknown as Response),
    ) as typeof fetch;

    const blocked = await resolveEvidenceRecords(["NHTSA tire pressure guidance"], "claim x");
    expect(blocked.records[0].snapshotStatus).toBe("fetch_blocked");
    expect(blocked.records[0].snapshotHash).toBeNull();
    expect(blocked.records[0].confidence).toBe(0.5);

    const fetched = await resolveEvidenceRecords(["Car Care Council battery maintenance guidance"], "claim x");
    expect(fetched.records[0].snapshotStatus).toBe("fetched");
    expect(fetched.records[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetched.records[0].confidence).toBe(0.7);
  });

  it("expired records are not live", () => {
    const rec = {
      id: "evr_x", handle: "h", sourceType: "public_registry" as const, assertion: "a", claim: "c",
      retrievedAt: "2025-01-01T00:00:00Z", expiresAt: "2025-06-01T00:00:00Z",
      snapshotHash: null, snapshotStatus: "not_attempted" as const, entailment: "not_evaluated" as const,
      confidence: 0.7, sensitivity: "public" as const,
    };
    expect(isEvidenceRecordLive(rec, new Date("2026-07-17"))).toBe(false);
    expect(isEvidenceRecordLive({ ...rec, expiresAt: "2027-01-01T00:00:00Z" }, new Date("2026-07-17"))).toBe(true);
  });
});
