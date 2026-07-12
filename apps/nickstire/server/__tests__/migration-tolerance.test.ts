/**
 * Regression tests for the migration runner's tolerated-error policy.
 * The 2026-07-12 driver: prod TiDB throws errno 8200 on an older migration's
 * expression index, and the runner (db-migrate.ts) halted there before reaching
 * new migrations. These tests lock in that 8200 is tolerated (so the runner
 * continues) WITHOUT loosening tolerance for genuine failures.
 */
import { describe, it, expect } from "vitest";
import { isTolerableError, TOLERATED_ERRNOS } from "../../scripts/migration-tolerance";

describe("migration-tolerance — isTolerableError", () => {
  it("tolerates TiDB errno 8200 so the runner continues past a redundant expression index", () => {
    // The exact error prod TiDB throws on migration 0046's expression index.
    expect(
      isTolerableError({
        errno: 8200,
        sqlState: "HY000",
        message:
          "Unsupported creating expression index containing unsafe functions without allow-expression-index in config",
      }),
    ).toBe(true);
  });

  it("tolerates the 8200 case by message alone (engines that omit errno)", () => {
    expect(
      isTolerableError({ message: "Unsupported creating expression index containing unsafe functions" }),
    ).toBe(true);
  });

  it("still tolerates the classic idempotent cases (table/index already exists)", () => {
    expect(isTolerableError({ errno: 1050, code: "ER_TABLE_EXISTS_ERROR", message: "Table 'x' already exists" })).toBe(true);
    expect(isTolerableError({ errno: 1061, message: "Duplicate key name 'sms_variant_idx'" })).toBe(true);
  });

  it("does NOT tolerate a real SQL syntax error (must halt the deploy)", () => {
    expect(isTolerableError({ errno: 1064, code: "ER_PARSE_ERROR", message: "You have an error in your SQL syntax" })).toBe(false);
  });

  it("does NOT tolerate an unknown/novel failure", () => {
    expect(isTolerableError({ errno: 9999, message: "some novel failure" })).toBe(false);
  });

  it("registers 8200 in TOLERATED_ERRNOS", () => {
    expect(TOLERATED_ERRNOS.has(8200)).toBe(true);
  });
});
