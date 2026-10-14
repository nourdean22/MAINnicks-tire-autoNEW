/**
 * Stripe webhook decisions (server/lib/stripeWebhook.ts).
 *
 * - A paid event whose invoice cannot be recorded answers 500, so Stripe retries
 *   it. A 200 there drops the payment record for good.
 * - An amount that differs from invoices.totalAmount is never marked paid. A retry
 *   cannot change the amount, so that answer is 200.
 * - The idempotency claim pins the total it checked, so a row edited between the
 *   read and the write cannot be marked paid at the old amount.
 *
 * Only the database is replaced. The real drizzle statements are rendered with the
 * MySQL dialect, so the assertions read the SQL that would reach TiDB.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { markInvoicePaid, stripeWebhookPreflight } from "./stripeWebhook";

const h = vi.hoisted(() => ({
  db: null as Record<string, unknown> | null,
  row: null as { totalAmount: number; paymentStatus: string } | null,
  updateWheres: [] as unknown[],
  affectedRows: 1,
  // Row returned by the second read, the re-check after a claim that matched no row.
  rowAfterClaim: undefined as { totalAmount: number; paymentStatus: string } | null | undefined,
  selects: 0,
  failSelect: null as Error | null,
  failUpdate: null as Error | null,
}));

vi.mock("../db", () => ({
  getDb: async () => h.db,
}));

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (h.failSelect) throw h.failSelect;
            h.selects += 1;
            const row = h.selects > 1 && h.rowAfterClaim !== undefined ? h.rowAfterClaim : h.row;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async (cond: unknown) => {
          if (h.failUpdate) throw h.failUpdate;
          h.updateWheres.push(cond);
          return { affectedRows: h.affectedRows };
        },
      }),
    }),
  };
}

const INVOICE = "INV-20261014-001";
const PI = "pi_test_0001";

beforeEach(() => {
  h.db = fakeDb();
  h.row = { totalAmount: 12345, paymentStatus: "pending" };
  h.updateWheres = [];
  h.affectedRows = 1;
  h.rowAfterClaim = undefined;
  h.selects = 0;
  h.failSelect = null;
  h.failUpdate = null;
});

/** Captures what the logger writes (warn to stdout, error to stderr). Restore in finally. */
function captureLogs() {
  const out: string[] = [];
  const err: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (out.push(String(c)), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => (err.push(String(c)), true));
  return { out, err, restore: () => { o.mockRestore(); e.mockRestore(); } };
}

describe("stripeWebhookPreflight", () => {
  it("answers 500 when the webhook secret is set but the API key is missing, so Stripe retries", () => {
    const logs = captureLogs();
    try {
      const pre = stripeWebhookPreflight({ webhookSecret: "whsec_test", secretKey: undefined });
      expect(pre).toMatchObject({ ok: false, status: 500 });
      expect(logs.err.join("")).toContain("STRIPE_SECRET_KEY is missing");
    } finally {
      logs.restore();
    }
  });

  it("keeps answering 500 when the secret is missing but the API key is set", () => {
    const logs = captureLogs();
    try {
      expect(stripeWebhookPreflight({ webhookSecret: undefined, secretKey: "sk_test_x" })).toMatchObject({ ok: false, status: 500 });
    } finally {
      logs.restore();
    }
  });

  it("keeps answering 200 silently when Stripe is not configured at all", () => {
    const logs = captureLogs();
    try {
      expect(stripeWebhookPreflight({ webhookSecret: undefined, secretKey: undefined })).toEqual({ ok: false, status: 200 });
      expect(logs.err.join("")).toBe("");
    } finally {
      logs.restore();
    }
  });

  it("proceeds with both values, returning them for signature verification", () => {
    expect(stripeWebhookPreflight({ webhookSecret: "whsec_test", secretKey: "sk_test_x" })).toEqual({
      ok: true,
      webhookSecret: "whsec_test",
      secretKey: "sk_test_x",
    });
  });
});

describe("markInvoicePaid", () => {
  it("answers db_unavailable and writes nothing when the database is down", async () => {
    h.db = null;
    const out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    expect(out.kind).toBe("db_unavailable");
    expect(h.updateWheres).toHaveLength(0);
  });

  it("refuses to mark paid when the Stripe amount differs from invoices.totalAmount, and logs both amounts", async () => {
    const logs = captureLogs();
    let out;
    try {
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 9999, paymentIntentId: PI });
      expect(logs.err.join("")).toContain(INVOICE);
      expect(logs.err.join("")).toContain("12345");
      expect(logs.err.join("")).toContain("9999");
    } finally {
      logs.restore();
    }
    expect(out).toEqual({ kind: "amount_mismatch", invoiceNumber: INVOICE, expectedCents: 12345, receivedCents: 9999 });
    expect(h.updateWheres).toHaveLength(0);
  });

  it("marks paid when the amounts match, and the claim pins the total it checked", async () => {
    const out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    expect(out).toEqual({ kind: "claimed", invoiceNumber: INVOICE });
    expect(h.updateWheres).toHaveLength(1);
    const { sql, params } = new MySqlDialect().sqlToQuery(h.updateWheres[0] as SQL);
    expect(sql).toMatch(/`paymentStatus` <> \?/i);
    expect(sql).toMatch(/`totalAmount` = \?/i);
    expect(params).toContain(12345);
  });

  it("accepts a difference of up to 50 cents, the tolerance payments.confirmPayment already uses", async () => {
    const out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12295, paymentIntentId: PI });
    expect(out.kind).toBe("claimed");
  });

  it("refuses 51 cents off", async () => {
    const logs = captureLogs();
    let out;
    try {
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12294, paymentIntentId: PI });
    } finally {
      logs.restore();
    }
    expect(out.kind).toBe("amount_mismatch");
    expect(h.updateWheres).toHaveLength(0);
  });

  it("answers not_found when no invoice carries the number, and writes nothing", async () => {
    const logs = captureLogs();
    let out;
    try {
      h.row = null;
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    } finally {
      logs.restore();
    }
    expect(out).toEqual({ kind: "not_found", invoiceNumber: INVOICE });
    expect(h.updateWheres).toHaveLength(0);
  });

  it("answers not_claimed on a Stripe retry, when the invoice is already paid", async () => {
    h.row = { totalAmount: 12345, paymentStatus: "paid" };
    h.affectedRows = 0;
    const out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    expect(out).toEqual({ kind: "not_claimed", invoiceNumber: INVOICE });
  });

  it("answers db_unavailable when the handle is set but the read throws, so Stripe retries", async () => {
    h.failSelect = new Error("connect ECONNREFUSED 10.0.0.7:4000");
    const logs = captureLogs();
    let out;
    try {
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    } finally {
      logs.restore();
    }
    expect(out).toEqual({ kind: "db_unavailable" });
    expect(h.updateWheres).toHaveLength(0);
  });

  it("answers db_unavailable when the claim UPDATE throws, so Stripe retries", async () => {
    h.failUpdate = new Error("Lock wait timeout exceeded; try restarting transaction");
    const logs = captureLogs();
    let out;
    try {
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    } finally {
      logs.restore();
    }
    expect(out).toEqual({ kind: "db_unavailable" });
  });

  it("logs an error with both amounts when the total changes during the claim", async () => {
    h.affectedRows = 0;
    h.rowAfterClaim = { totalAmount: 12400, paymentStatus: "pending" };
    const logs = captureLogs();
    let out;
    try {
      out = await markInvoicePaid({ invoiceNumber: INVOICE, receivedCents: 12345, paymentIntentId: PI });
    } finally {
      logs.restore();
    }
    expect(out).toEqual({ kind: "not_claimed", invoiceNumber: INVOICE });
    expect(logs.err.join("")).toContain("12345");
    expect(logs.err.join("")).toContain("12400");
  });
});
