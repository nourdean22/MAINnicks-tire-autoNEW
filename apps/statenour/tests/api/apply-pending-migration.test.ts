/**
 * tests/api/apply-pending-migration.test.ts · ledger drift-guard lock.
 *
 * 2026-07-29: the apply endpoint used to INSERT a `manual-endpoint-<name>`
 * row into _prisma_migrations after applying its registry SQL. Rows for
 * names with no prisma/migrations/<name>/ dir are exactly what turned
 * `prisma migrate status` red (9 orphan rows deleted in the ledger
 * reconciliation — docs/STATENOUR-OBSERVABILITY-TRUTH-ARC.2026-07-29.cgd.md).
 * Nothing in this repo runs `migrate deploy`, so the insert protected a
 * consumer that does not exist while breaking the one that does.
 *
 * These tests lock the contract: the endpoint applies registry DDL and
 * NEVER touches _prisma_migrations; recording is the canonical flow's job
 * (`prisma migrate resolve --applied <name>`), and the response says so.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeRawUnsafe, queryRawUnsafe } = vi.hoisted(() => ({
  executeRawUnsafe: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRawUnsafe: executeRawUnsafe,
    $queryRawUnsafe: queryRawUnsafe,
  },
}));

import { POST } from "@/app/api/system/apply-pending-migration/route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/system/apply-pending-migration", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  executeRawUnsafe.mockReset().mockResolvedValue(0);
  queryRawUnsafe.mockReset().mockResolvedValue([{ count: 0 }]);
});

describe("POST /api/system/apply-pending-migration · ledger drift-guard", () => {
  it("applies registry DDL without ever touching _prisma_migrations", async () => {
    const res = await post({ name: "0007_brain_fts" });
    expect(res.status).toBe(200);
    expect(executeRawUnsafe).toHaveBeenCalled();
    for (const call of [...executeRawUnsafe.mock.calls, ...queryRawUnsafe.mock.calls]) {
      expect(String(call[0])).not.toMatch(/_prisma_migrations/i);
    }
  });

  it("tells the operator the ledger step instead of writing it", async () => {
    const res = await post({ name: "0007_brain_fts" });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.applied).toBe(true);
    expect(String(json.ledger)).toMatch(/migrate resolve --applied/);
    // The old silent-recording contract is gone for good.
    expect("migrationRecorded" in json).toBe(false);
  });

  it("still refuses names outside the deploy-gated registry", async () => {
    const res = await post({ name: "not-a-registered-migration" });
    expect(res.status).toBe(400);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});
