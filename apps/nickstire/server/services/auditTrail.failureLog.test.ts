/**
 * A failed audit-trail write logs what failed, never the row it was writing
 * (PROTECTED-CORE rule 5; found in the review of #2782, 2026-09-29).
 *
 * logAdminAction's catch logged `err.message`. A drizzle query error's message
 * is "Failed query: insert into `audit_log` ...\nparams: <every bound value>",
 * so one failed insert copied the whole row into the logs: the details, the
 * before/after snapshots and any customer note. sanitizeSnapshot masks phones
 * and emails, but names and free text pass through. The catch now logs
 * describeDbError: class names and driver codes, no message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  errorCalls: [] as Array<[string, Record<string, unknown>]>,
  insertError: null as unknown,
}));

vi.mock("../lib/db-helper", () => ({
  db: async () => ({
    insert: () => ({
      values: async () => {
        throw h.insertError;
      },
    }),
  }),
}));

vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "audit-trail"
        ? {
            error: (msg: string, meta: Record<string, unknown>) => h.errorCalls.push([msg, meta]),
            warn: () => {},
            info: () => {},
            debug: () => {},
          }
        : (actual.createLogger as (n: string) => unknown)(name),
  };
});

const SENSITIVE = "Test Customer said SENSITIVE-BOUND-VALUE about the 2016 Civic";

/** The shape drizzle 0.45 throws: the query and every bound param in `message`. */
class DrizzleQueryError extends Error {
  constructor(
    public query: string,
    public params: unknown[],
    public override cause: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(",")}`);
  }
}

function driverError(): Error {
  const e = new Error("Data too long for column 'after_json' at row 1") as Error & { code: string; errno: number };
  e.code = "ER_DATA_TOO_LONG";
  e.errno = 1406;
  return e;
}

describe("logAdminAction · a failed insert logs no bound value", () => {
  beforeEach(() => {
    h.errorCalls.length = 0;
    h.insertError = new DrizzleQueryError(
      "insert into `audit_log` (`id`, `actor`, `action`, `details`, `after_json`) values (?, ?, ?, ?, ?)",
      ["a1b2", "owner@example.test", "inspection.item_decided", SENSITIVE, JSON.stringify({ note: SENSITIVE })],
      driverError(),
    );
  });

  it("logs the failure without the row's contents", async () => {
    const { logAdminAction } = await import("./auditTrail");
    await logAdminAction({
      action: "inspection.item_decided" as never,
      entityType: "inspection_item",
      entityId: 7,
      details: SENSITIVE,
      afterJson: { note: SENSITIVE },
    });

    expect(h.errorCalls).toHaveLength(1);
    const [msg, meta] = h.errorCalls[0]!;
    expect(msg).toBe("Audit trail write failed");
    const logged = JSON.stringify(meta);
    expect(logged).not.toContain("SENSITIVE-BOUND-VALUE");
    expect(logged).not.toContain("Test Customer");
    expect(logged).not.toContain("owner@example.test");
  });

  it("still says what failed: the error class and the driver's code", async () => {
    const { logAdminAction } = await import("./auditTrail");
    await logAdminAction({
      action: "inspection.item_decided" as never,
      entityType: "inspection_item",
      entityId: 7,
      details: SENSITIVE,
    });

    const [, meta] = h.errorCalls[0]!;
    expect(String(meta.error)).toContain("DrizzleQueryError");
    expect(String(meta.error)).toContain("ER_DATA_TOO_LONG");
    expect(meta).toMatchObject({ action: "inspection.item_decided", entityType: "inspection_item", entityId: 7 });
  });
});
