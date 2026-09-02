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

/**
 * Model a database in which the CREATE INDEX statements actually worked.
 *
 * 2026-09-02 · the route now verifies every index it claims to create against
 * pg_indexes before answering applied:true (added after a review finding on
 * PR #2086: a duplicate-key failure was being swallowed as "skip" and the
 * route reported success with no index created). A blanket
 * `mockResolvedValue([{ count: 0 }])` answers that verification with zero
 * matching index names, which the route correctly reads as "they are missing"
 * -- so the fixture, not the route, is what needs to know about the check.
 */
function databaseWhereIndexesGetCreated(sql: string, ...params: unknown[]) {
  if (/pg_indexes/i.test(String(sql))) {
    return params.map((indexname) => ({ indexname }));
  }
  return [{ count: 0 }];
}

beforeEach(() => {
  executeRawUnsafe.mockReset().mockResolvedValue(0);
  queryRawUnsafe.mockReset().mockImplementation(async (sql: string, ...params: unknown[]) =>
    databaseWhereIndexesGetCreated(sql, ...params),
  );
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

  /**
   * The post-apply verification, canaried. Without these two, the route could
   * silently stop verifying and every test above would stay green -- which is
   * exactly the shape ("reported success, did nothing") that the verification
   * was added to close.
   */
  it("refuses applied:true when an index it claimed to create is not there", async () => {
    queryRawUnsafe.mockImplementation(async (sql: string) =>
      /pg_indexes/i.test(String(sql)) ? [] : [{ count: 0 }],
    );
    const res = await post({ name: "0007_brain_fts" });
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.applied).toBe(false);
    expect(Array.isArray(json.missingIndexes)).toBe(true);
    expect((json.missingIndexes as string[]).length).toBeGreaterThan(0);
    // The operator is pointed at the actual cause, not just told "failed".
    expect(String(json.error)).toMatch(/duplicate non-null keys|preflight/i);
  });

  it("a verification that cannot RUN is not a verification that passed", async () => {
    // Failing closed matters more here than anywhere else in the route: this
    // is the last check between "statements did not throw" and telling the
    // operator to run `prisma migrate resolve --applied`.
    queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (/pg_indexes/i.test(String(sql))) throw new Error("connection terminated");
      return [{ count: 0 }];
    });
    const res = await post({ name: "0007_brain_fts" });
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.applied).toBe(false);
    expect(String(json.error)).toMatch(/unconfirmed/i);
  });

  it("still refuses names outside the deploy-gated registry", async () => {
    const res = await post({ name: "not-a-registered-migration" });
    expect(res.status).toBe(400);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});
