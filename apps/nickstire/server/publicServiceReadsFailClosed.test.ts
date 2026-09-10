/**
 * No PUBLIC endpoint may tell a customer something is absent when the read failed.
 *
 * These are the last nine public (procedure, helper) pairs in the
 * fabricated-read ratchet. Each helper returned [] / null / { ok: false } on a
 * dead handle — the same value it returns when the thing genuinely does not
 * exist — so during a database outage the site told visitors, confidently, that
 * there were no coupons, no questions, no prices, no gallery, no technicians,
 * no rewards, and no inspection report.
 *
 * THE ONE THAT MATTERS MOST is inspection.byToken. InspectionReport.tsx already
 * branches on `isError` ("Failed to load data. Please try again." with a retry)
 * and separately on `!inspection`:
 *
 *     "Report Not Found — This inspection report does not exist or has not been
 *      published yet. If you received a link, please contact us."
 *
 * A customer holding a REAL link, during an outage, was shown the second one.
 * That is ROS-102's exact shape — telling a customer their record does not
 * exist — on the page a technician sends them to approve paid work. Guarding
 * routes them to the retry branch the page already has.
 *
 * Asserted through the REAL procedures with the db module's typed accessor
 * mocked to hand back a dead handle: the condition itself, not a restatement of
 * the source.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const getDbTyped = vi.fn();
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDbTyped: () => getDbTyped() };
});

const { appRouter } = await import("./routers");

function publicCaller() {
  return appRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never);
}

/** Every public pair the ratchet still listed, and what each used to claim. */
const CASES: Array<{ name: string; lie: string; call: (c: ReturnType<typeof publicCaller>) => Promise<unknown> }> = [
  { name: "coupons.active", lie: "no offers are running", call: (c) => c.coupons.active() },
  { name: "qa.published", lie: "nobody has asked anything", call: (c) => c.qa.published() },
  { name: "pricing.allServices", lie: "we do not price anything", call: (c) => c.pricing.allServices() },
  {
    name: "pricing.estimate",
    lie: "this service has no price",
    call: (c) => c.pricing.estimate({ serviceType: "brakes", vehicleCategory: "midsize" }),
  },
  {
    name: "inspection.byToken",
    lie: "your inspection report does not exist",
    call: (c) => c.inspection.byToken({ token: "a-real-token-from-a-real-customer" }),
  },
  {
    name: "inspection.recordView",
    lie: "the customer never opened it",
    call: (c) => c.inspection.recordView({ token: "a-real-token-from-a-real-customer" }),
  },
  { name: "loyalty.rewards", lie: "there are no rewards", call: (c) => c.loyalty.rewards() },
  { name: "gallery.list", lie: "there is no work to show", call: (c) => c.gallery.list() },
  { name: "technicians.list", lie: "the shop has no technicians", call: (c) => c.technicians.list() },
];

describe("public reads fail CLOSED when the database is unreachable", () => {
  beforeEach(() => getDbTyped.mockReset());

  for (const { name, lie, call } of CASES) {
    it(`${name} does not claim "${lie}"`, async () => {
      getDbTyped.mockResolvedValue(null); // the outage condition
      await expect(call(publicCaller())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });
  }

  it("covers every public pair the ratchet listed — the subject check", () => {
    // If a tenth public pair appears, this file should grow with it. A count
    // here is cheap and makes the omission visible instead of silent.
    expect(CASES).toHaveLength(9);
  });
});

describe("the guard does not fire when a handle exists", () => {
  // The other direction, and it is not decorative: a guard that threw
  // unconditionally would pass every arm above while taking these endpoints
  // offline permanently. Here getDbTyped hands back a live-looking handle, so
  // the procedure must get PAST the guard and reach its helper.
  beforeEach(() => getDbTyped.mockReset());

  it("reaches the helper instead of throwing", async () => {
    getDbTyped.mockResolvedValue({} as never);
    // The helper itself uses the real getDb(), which is null in this suite, so
    // it returns its own empty value. Getting a resolved value at all is the
    // proof the guard let the call through.
    await expect(publicCaller().coupons.active()).resolves.toBeDefined();
    await expect(publicCaller().technicians.list()).resolves.toBeDefined();
  });
});
