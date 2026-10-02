/**
 * Paid ALG invoices create exactly one pending review_requests row each — never before
 * migration 0139, never inside a phone's cooldown, never twice for one invoice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ready: { hasInvoiceId: 1, bookingNullable: 1 } as Record<string, unknown>,
  candidates: [] as Array<Record<string, unknown>>,
  inserts: [] as string[],
  queries: [] as string[],
  dupOnInvoice: new Set<number>(),
  cooldownPhones: new Set<string>(),
  enabled: 1,
}));

const text = (q: unknown) => JSON.stringify(q);

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    execute: async (q: unknown) => {
      const t = text(q);
      h.queries.push(t);
      if (t.includes("information_schema.COLUMNS")) return [[h.ready], []];
      if (t.includes("FROM invoices i")) return [h.candidates, []];
      if (t.includes("INSERT INTO review_requests")) {
        const id = h.candidates.find((c) => t.includes(`${c.id}`) && h.dupOnInvoice.has(Number(c.id)));
        if (id) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
        h.inserts.push(t);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected query ${t.slice(0, 80)}`);
    },
  })),
  getReviewSettings: vi.fn(async () => ({ enabled: h.enabled, delayMinutes: 1440, maxPerDay: 20, cooldownDays: 30 })),
  isPhoneOnReviewCooldown: vi.fn(async (phone: string) => {
    if (h.cooldownPhones.has(phone)) return true;
    // Same as production: a row just inserted for this phone puts it on cooldown.
    return h.inserts.some((i) => i.includes(phone));
  }),
}));

import { createInvoiceReviewRequests } from "./invoiceReviewRequests";

afterEach(() => {
  h.ready = { hasInvoiceId: 1, bookingNullable: 1 };
  h.candidates = [];
  h.inserts = [];
  h.queries = [];
  h.dupOnInvoice.clear();
  h.cooldownPhones.clear();
  h.enabled = 1;
});

describe("createInvoiceReviewRequests", () => {
  it("is inert until migration 0139 is applied — no candidate read, no insert", async () => {
    h.ready = { hasInvoiceId: 0, bookingNullable: 0 };
    const out = await createInvoiceReviewRequests();
    expect(out.reason).toMatch(/0139.*not applied/);
    expect(h.queries.some((q) => q.includes("FROM invoices i"))).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it("half-applied 0139 (column added, bookingId still NOT NULL) is also inert", async () => {
    h.ready = { hasInvoiceId: 1, bookingNullable: 0 };
    expect((await createInvoiceReviewRequests()).reason).toMatch(/not applied/);
  });

  it("settings disabled -> nothing created, reason stated", async () => {
    h.enabled = 0;
    const out = await createInvoiceReviewRequests();
    expect(out.reason).toMatch(/disabled/);
    expect(h.inserts).toHaveLength(0);
  });

  it("one pending row per paid invoice, bookingId NULL, invoiceId set", async () => {
    h.candidates = [
      { id: 101, name: "Pat", phone: "2165550101", service: "Brake pads" },
      { id: 102, name: "Lee", phone: "2165550102", service: "Alignment" },
    ];
    const out = await createInvoiceReviewRequests();
    expect(out).toMatchObject({ created: 2, onCooldown: 0, duplicate: 0, candidates: 2 });
    expect(h.inserts[0]).toContain("NULL");
    expect(h.inserts[0]).toContain("pending");
  });

  it("two invoices for one phone in a batch -> one row (the cooldown sees the first)", async () => {
    h.candidates = [
      { id: 201, name: "Pat", phone: "2165550201", service: "Tires" },
      { id: 202, name: "Pat", phone: "2165550201", service: "Balance" },
    ];
    const out = await createInvoiceReviewRequests();
    expect(out).toMatchObject({ created: 1, onCooldown: 1 });
  });

  it("a phone already asked inside the cooldown is skipped", async () => {
    h.candidates = [{ id: 301, name: "Kim", phone: "2165550301", service: "Oil" }];
    h.cooldownPhones.add("2165550301");
    expect(await createInvoiceReviewRequests()).toMatchObject({ created: 0, onCooldown: 1 });
  });

  it("a concurrent run that already scheduled the invoice is a duplicate, not a failure", async () => {
    h.candidates = [{ id: 401, name: "Ray", phone: "2165550401", service: "Diag" }];
    h.dupOnInvoice.add(401);
    expect(await createInvoiceReviewRequests()).toMatchObject({ created: 0, duplicate: 1 });
  });

  it("candidates are paid shopdriver invoices from a short lookback, excluding opt-outs and the other lane's recent asks", async () => {
    await createInvoiceReviewRequests();
    const q = h.queries.find((t) => t.includes("FROM invoices i")) ?? "";
    expect(q).toContain("i.source = 'shopdriver' AND i.paymentStatus = 'paid'");
    expect(q).toContain("NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.invoiceId = i.id)");
    expect(q).toContain("c.smsOptOut = 1 OR c.smsCampaignDate >=");
  });
});
