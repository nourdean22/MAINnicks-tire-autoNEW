/**
 * Q-29 · POST /api/sync/backup stores a counts-only digest.
 *
 * nickstire's "db-backup" job used to POST every lead, booking and invoice row
 * from the last 24 h, and this route stored the body verbatim in
 * `audit_events.payload` — customer names, phones and amounts in a second
 * store with no reader. nickstire now sends counts only; this receiver ALSO
 * whitelists the count keys, so a stale sender (deploy skew, a rollback) or a
 * future edit cannot land rows here again.
 *
 * Positive control first: a well-formed digest is stored with its counts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { auditCreate, auditFindFirst, requireSyncAuth } = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  auditFindFirst: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: auditCreate, findFirst: auditFindFirst },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: (req: Request) => requireSyncAuth(req),
  requireEvidenceAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));

const ROW = {
  id: 4242,
  name: "Digest Canary Person",
  phone: "2165550142",
  email: "digest.canary@example.test",
  totalAmount: 51234,
};
const MARKERS = ["Digest Canary Person", "2165550142", "digest.canary@example.test"];

const digest = {
  kind: "daily_digest",
  date: "2026-09-30",
  timestamp: "2026-09-30T09:00:00.000Z",
  counts: { leads: 10, bookings: 4, invoices: 7, customers: 30, tireOrders: 2 },
  recent24h: { leads: 3, bookings: 1, invoices: 2 },
};

/** The body an un-updated nickstire (pre-Q-29) still sends. */
const legacy = {
  date: "2026-09-30",
  timestamp: "2026-09-30T09:00:00.000Z",
  counts: { leads: 10, bookings: 4, invoices: 7, customers: 30, tireOrders: 2 },
  recent24h: {
    leads: 1,
    bookings: 1,
    invoices: 1,
    leadsData: [ROW],
    bookingsData: [ROW],
    invoicesData: [ROW],
  },
  extra: { customer: ROW },
};

async function post(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/sync/backup/route");
  return POST(
    new Request("http://x/api/sync/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {} as never,
  );
}

function storedPayload(): Record<string, unknown> {
  expect(auditCreate).toHaveBeenCalledTimes(1);
  return auditCreate.mock.calls[0][0].data.payload as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  auditCreate.mockResolvedValue({ id: "ae_1" });
  auditFindFirst.mockResolvedValue(null);
});

describe("POST /api/sync/backup · counts-only digest (Q-29)", () => {
  it("stores a well-formed digest with its counts (positive control)", async () => {
    const res = await post(digest);
    expect(res.status).toBe(200);
    expect(storedPayload()).toEqual(digest);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      actor: "nickstire-backup",
      eventType: "daily_backup",
      detail: "Daily digest: 10 leads, 7 invoices, 30 customers",
    });
  });

  it("drops row arrays and unknown keys from a legacy body, keeping only the counts", async () => {
    const res = await post(legacy);
    expect(res.status).toBe(200);

    const stored = storedPayload();
    const raw = JSON.stringify(auditCreate.mock.calls[0][0].data);
    for (const marker of MARKERS) expect(raw).not.toContain(marker);
    expect(raw).not.toMatch(/leadsData|bookingsData|invoicesData/);
    expect(stored).toEqual({
      kind: "daily_digest",
      date: "2026-09-30",
      timestamp: "2026-09-30T09:00:00.000Z",
      counts: { leads: 10, bookings: 4, invoices: 7, customers: 30, tireOrders: 2 },
      recent24h: { leads: 1, bookings: 1, invoices: 1 },
    });
  });

  it("never stores a non-number where a count belongs, and bounds the date strings", async () => {
    await post({
      date: ROW.email,
      timestamp: "x".repeat(500),
      counts: { leads: ROW.phone, bookings: -3, invoices: 2.5, customers: Number.NaN, tireOrders: { rows: [ROW] } },
      recent24h: "rows",
    });
    const stored = storedPayload();
    const raw = JSON.stringify(stored);
    for (const marker of MARKERS) expect(raw).not.toContain(marker);
    expect(stored.counts).toEqual({ leads: null, bookings: null, invoices: null, customers: null, tireOrders: null });
    expect(stored.recent24h).toEqual({ leads: null, bookings: null, invoices: null });
    expect(stored.date).toBeNull();
    expect(stored.timestamp).toBeNull();
  });

  it("runs the sync auth guard before writing anything", async () => {
    const { ServiceError } = await import("@/lib/utils/service-error");
    requireSyncAuth.mockImplementationOnce(() => {
      throw new ServiceError("Unauthorized", 401);
    });
    const res = await post(digest);
    expect(res.status).toBe(401);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/sync/backup · counts-only on the way out (Q-29)", () => {
  async function get(): Promise<{ backup: unknown; date: unknown }> {
    const { GET } = await import("@/app/api/sync/backup/route");
    const res = await GET(new Request("http://x/api/sync/backup"), {} as never);
    expect(res.status).toBe(200);
    return (await res.json()).data;
  }

  it("serves a row written before Q-29 without its customer rows", async () => {
    const createdAt = new Date("2026-09-29T09:00:00.000Z");
    auditFindFirst.mockResolvedValueOnce({ payload: legacy, createdAt });
    const data = await get();

    const raw = JSON.stringify(data);
    for (const marker of MARKERS) expect(raw).not.toContain(marker);
    expect((data.backup as Record<string, unknown>).counts).toEqual(legacy.counts);
  });

  it("answers null when no digest has been stored", async () => {
    const data = await get();
    expect(data.backup).toBeNull();
  });
});
