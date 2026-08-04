/**
 * The two sites registered-not-fixed in PR #1343, now closed.
 *
 * ★ ITEM 1 — A LEDGER CATEGORY THAT COULD NEVER RECEIVE A ROW.
 *
 * scheduleReviewRequest wrapped its body in try/catch and the catch RESOLVED
 * (`return { scheduled: false, reason }`). Its only production caller,
 * booking.ts:578, is detached and already has BOTH halves wired — a .then that
 * discards the value and a .catch that calls logIntegrationFailure with
 * `failureType: "review_request"`. Because the catch resolved, that .catch could
 * never fire.
 *
 * booking.ts:585 is the ONLY site in the repo that writes a `review_request`
 * row — grep confirms it — and Site Health's integration-failures panel names
 * that exact category in its own doc comment: "sheets_sync / email / sms / capi
 * / review_request / reminders / invoice. Surfaces silent breakage that can lose
 * leads" (routers/admin/dashboard/health.ts:52). So the operator had a panel
 * advertising a class of failure it was structurally incapable of showing. Same
 * shape as gatewayTire's "Failed to load orders" branch in #1337: the UI was
 * right, the feed into it did not exist.
 *
 * Re-throwing is safe BECAUSE every business outcome is a RETURN, not a throw —
 * disabled, invalid phone and on-cooldown all return { scheduled: false, reason }.
 * Only a genuine failure reaches the catch, so the ledger cannot fill with
 * ordinary decisions. That property is asserted structurally below, because it
 * is the whole safety argument and a future refactor could quietly break it.
 *
 * ★ ITEM 2 — A GREEN CHECKMARK ASSERTING EVERY CUSTOMER WAS ASKED.
 *
 * getCompletedBookingsWithoutReview returned [] on an unreadable database, and
 * the Backfill tab renders `count > 0 ? <Send to N Customers> : <emerald
 * CheckCircle2 + "All eligible customers have already been contacted">`. A read
 * that never happened rendered as a year's worth of customers confirmed
 * contacted.
 *
 * DB-unavailable is induced by clearing DATABASE_URL, which is what getDb()
 * actually branches on — it is defined inside db.ts and called through its local
 * binding, so a module mock of the export would not intercept the internal call
 * sites and these would pass while exercising nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEDULER = readFileSync(join(__dirname, "routers", "reviewRequests.ts"), "utf8");
const BOOKING = readFileSync(join(__dirname, "routers", "booking.ts"), "utf8");
const HEALTH = readFileSync(join(__dirname, "routers", "admin", "dashboard", "health.ts"), "utf8");
const FAILURES = readFileSync(join(__dirname, "integration-failures.ts"), "utf8");
const CLIENT = readFileSync(
  join(__dirname, "..", "client", "src", "pages", "admin", "outreach", "ReviewRequestsSection.tsx"),
  "utf8",
);

/** The body of scheduleReviewRequest, so assertions cannot match its neighbours. */
const SCHEDULE_FN = SCHEDULER.slice(
  SCHEDULER.indexOf("export async function scheduleReviewRequest"),
  SCHEDULER.indexOf("function getClevelandHour"),
);

beforeEach(() => {
  vi.resetModules(); // db.ts caches its pool in module state
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("a failed review-request schedule reaches the ledger", () => {
  it("re-throws instead of resolving a false {scheduled:false}", () => {
    expect(SCHEDULE_FN).toMatch(/throw error;/);
    expect(SCHEDULE_FN).not.toMatch(/return \{ scheduled: false, reason: error\.message \}/);
  });

  it("still logs locally before re-throwing — the trace is not lost", () => {
    expect(SCHEDULE_FN).toMatch(/log\.error\("\[ReviewRequest\] Failed to schedule:"/);
  });

  it("lands in a handler that already exists and already writes the row", () => {
    // The plumbing was never the missing piece.
    expect(BOOKING).toMatch(/\.catch\(err => \{/);
    expect(BOOKING).toMatch(/failureType: "review_request"/);
    const call = BOOKING.indexOf("scheduleReviewRequest(booking.id");
    const handler = BOOKING.indexOf('failureType: "review_request"', call);
    expect(handler).toBeGreaterThan(call);
  });

  it("is the ONLY site that can write that category, and Site Health advertises it", () => {
    expect((BOOKING.match(/failureType: "review_request"/g) ?? []).length).toBe(1);
    expect(HEALTH).toMatch(/review_request/);
    expect(HEALTH).toMatch(/Surfaces silent breakage/);
  });

  it("cannot introduce an unhandled rejection — the logger is itself total", () => {
    // logIntegrationFailure runs inside the .catch, so a throw from IT would be
    // the unhandled rejection this change is accused of creating. It is not:
    // the whole body is try/caught with a db-null console fallback.
    expect(FAILURES).toMatch(/export async function logIntegrationFailure/);
    const fn = FAILURES.slice(FAILURES.indexOf("export async function logIntegrationFailure"));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch \(logErr\) \{/);
    expect(fn).toMatch(/Avoid infinite loops/);
  });

  it("★ every BUSINESS outcome is still a return — this is the safety argument", () => {
    // If any of these ever became a throw, ordinary decisions would start
    // filing integration failures and the ledger would stop meaning anything.
    expect(SCHEDULE_FN).toMatch(/return \{ scheduled: false, reason: "Review request system is disabled" \}/);
    expect(SCHEDULE_FN).toMatch(/return \{ scheduled: false, reason: "Invalid phone number" \}/);
    expect(SCHEDULE_FN).toMatch(/return \{ scheduled: false, reason: `Phone on cooldown/);
    expect(SCHEDULE_FN).toMatch(/return \{ scheduled: true \}/);
    // Exactly one throw STATEMENT in the function: the re-throw. Anchored to
    // line-start so it counts code, not prose — the comment above the re-throw
    // uses the word "throw" four times explaining why this property holds, and
    // a bare /\bthrow\b/ counts those too. (Third time this shape has bitten in
    // two days; see the .gitleaksignore note and the arrayBuffer assertion in
    // mp4IngestDoor.test.ts.)
    expect((SCHEDULE_FN.match(/^\s*throw /gm) ?? []).length).toBe(1);
  });
});

describe("the re-throw, exercised rather than read", () => {
  // The assertions above are structural. They catch a revert, but they cannot
  // show that the function BEHAVES this way — and "assert the mechanism, do not
  // merely exercise it" cuts both directions. These run the real function with
  // the db module mocked, so they need no database and run in normal CI, unlike
  // the HAS_DB-gated cases in routers.test.ts.
  afterEach(() => {
    vi.doUnmock("./db");
  });

  const HEALTHY_SETTINGS = {
    id: 1, enabled: 1, delayMinutes: 1440, maxPerDay: 20,
    cooldownDays: 30, messageTemplate: null, updatedAt: new Date(),
  };

  it("REJECTS when the write genuinely fails — this is what fills the ledger", async () => {
    vi.doMock("./db", () => ({
      getReviewSettings: vi.fn().mockResolvedValue(HEALTHY_SETTINGS),
      isPhoneOnReviewCooldown: vi.fn().mockResolvedValue(false),
      // The real failure this models: review_requests.bookingId carries an FK to
      // bookings.id (drizzle/schema.ts:676), so a non-existent booking rejects.
      createReviewRequest: vi.fn().mockRejectedValue(new Error("ER_NO_REFERENCED_ROW_2")),
      getReviewRequests: vi.fn(),
      getPendingReviewRequests: vi.fn(),
      getReviewRequestStats: vi.fn(),
      getReviewRequestsSentToday: vi.fn(),
      getCompletedBookingsWithoutReview: vi.fn(),
      updateReviewSettings: vi.fn(),
      claimReviewRequest: vi.fn(),
      markReviewRequestSent: vi.fn(),
      markReviewRequestFailed: vi.fn(),
      getDb: vi.fn().mockResolvedValue(null),
    }));
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    await expect(scheduleReviewRequest(99999, "Test User", "2165551234", "Brake Repair"))
      .rejects.toThrow(/ER_NO_REFERENCED_ROW_2/);
  });

  it("RESOLVES for a business decision — a cooldown is not an integration failure", async () => {
    const createReviewRequest = vi.fn();
    vi.doMock("./db", () => ({
      getReviewSettings: vi.fn().mockResolvedValue(HEALTHY_SETTINGS),
      isPhoneOnReviewCooldown: vi.fn().mockResolvedValue(true),
      createReviewRequest,
      getReviewRequests: vi.fn(),
      getPendingReviewRequests: vi.fn(),
      getReviewRequestStats: vi.fn(),
      getReviewRequestsSentToday: vi.fn(),
      getCompletedBookingsWithoutReview: vi.fn(),
      updateReviewSettings: vi.fn(),
      claimReviewRequest: vi.fn(),
      markReviewRequestSent: vi.fn(),
      markReviewRequestFailed: vi.fn(),
      getDb: vi.fn().mockResolvedValue(null),
    }));
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    const r = await scheduleReviewRequest(1, "Test User", "2165551234", "Brake Repair");
    expect(r.scheduled).toBe(false);
    expect(r.reason).toMatch(/cooldown/i);
    expect(createReviewRequest).not.toHaveBeenCalled();
  });

  it("RESOLVES for an invalid phone, without ever reaching the database", async () => {
    const getReviewSettings = vi.fn().mockResolvedValue(HEALTHY_SETTINGS);
    const isPhoneOnReviewCooldown = vi.fn();
    vi.doMock("./db", () => ({
      getReviewSettings,
      isPhoneOnReviewCooldown,
      createReviewRequest: vi.fn(),
      getReviewRequests: vi.fn(),
      getPendingReviewRequests: vi.fn(),
      getReviewRequestStats: vi.fn(),
      getReviewRequestsSentToday: vi.fn(),
      getCompletedBookingsWithoutReview: vi.fn(),
      updateReviewSettings: vi.fn(),
      claimReviewRequest: vi.fn(),
      markReviewRequestSent: vi.fn(),
      markReviewRequestFailed: vi.fn(),
      getDb: vi.fn().mockResolvedValue(null),
    }));
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    const r = await scheduleReviewRequest(1, "Test User", "123", "Oil Change");
    expect(r.scheduled).toBe(false);
    expect(r.reason).toMatch(/invalid phone/i);
    expect(isPhoneOnReviewCooldown).not.toHaveBeenCalled();
  });

  it("REJECTS when the SETTINGS read fails — the #1343 throw propagates through", async () => {
    // getReviewSettings now throws on an unreadable database (PR #1343). That
    // throw must reach the ledger too, not be converted back into a resolved
    // {scheduled:false} by this function.
    vi.doMock("./db", () => ({
      getReviewSettings: vi.fn().mockRejectedValue(new Error("Database unavailable — review settings are unknown")),
      isPhoneOnReviewCooldown: vi.fn(),
      createReviewRequest: vi.fn(),
      getReviewRequests: vi.fn(),
      getPendingReviewRequests: vi.fn(),
      getReviewRequestStats: vi.fn(),
      getReviewRequestsSentToday: vi.fn(),
      getCompletedBookingsWithoutReview: vi.fn(),
      updateReviewSettings: vi.fn(),
      claimReviewRequest: vi.fn(),
      markReviewRequestSent: vi.fn(),
      markReviewRequestFailed: vi.fn(),
      getDb: vi.fn().mockResolvedValue(null),
    }));
    const { scheduleReviewRequest } = await import("./routers/reviewRequests");
    await expect(scheduleReviewRequest(1, "Test User", "2165551234", "Brake Repair"))
      .rejects.toThrow(/settings are unknown/i);
  });
});

describe("backfill eligibility is unknown, not empty", () => {
  it("getCompletedBookingsWithoutReview throws instead of returning []", async () => {
    const { getCompletedBookingsWithoutReview } = await import("./db");
    await expect(getCompletedBookingsWithoutReview()).rejects.toThrow(/unknown, not empty/i);
  });

  it("names what the green checkmark used to assert", async () => {
    const { getCompletedBookingsWithoutReview } = await import("./db");
    await expect(getCompletedBookingsWithoutReview()).rejects.toThrow(/who has already been asked/i);
  });
});

describe("the Backfill tab stops claiming everyone was contacted", () => {
  it("guards on DATA, not just isError — the offline PWA pauses the query", () => {
    expect(CLIENT).toMatch(/const backfillUnknown = backfillError \|\| \(!backfillLoading && !backfillPreview\);/);
  });

  it("★ asks whether the count is KNOWABLE before trusting it — the stale-refetch trap", () => {
    // react-query retains data on a failed refetch and this page refetches on
    // window focus (main.tsx:26). Testing the count first would see a stale
    // `count: 12` while the read was failing and render "Send to 12 Customers",
    // putting a real SMS batch behind a number nobody could confirm. This is
    // the same "test unknown BEFORE the data" rule that LeadsSection needed.
    expect(CLIENT).toMatch(/\{!backfillUnknown && \(backfillPreview\?\.count \?\? 0\) > 0 \? \(/);
    expect(CLIENT).not.toMatch(/\{\(backfillPreview\?\.count \?\? 0\) > 0 \? \(/);
  });

  it("keeps the green all-clear for a COUNTED zero, which is real information", () => {
    // The unknown branch is inserted BEFORE it, so the emerald tick is now only
    // reachable when the read succeeded and genuinely returned nothing to do.
    const unknownBranch = CLIENT.indexOf(") : backfillUnknown ? (");
    const allClear = CLIENT.indexOf("All eligible customers have already been contacted");
    expect(unknownBranch).toBeGreaterThan(-1);
    expect(allClear).toBeGreaterThan(unknownBranch);
  });

  it("em-dashes both counts rather than showing a confident zero", () => {
    expect(CLIENT).toMatch(/value=\{backfillUnknown \? "—" : backfillPreview\?\.count \?\? 0\}/);
    expect(CLIENT).toMatch(/value=\{backfillUnknown \? "—" : backfillPreview\?\.bookings\?\.length \?\? 0\}/);
  });

  it("★ does not answer a false claim about the PAST with a false claim about the PRESENT", () => {
    // The removed sentence was about the shop's HISTORY ("everyone has already
    // been contacted"). Denying it must not be done with an unconditional claim
    // about its PRESENT: "nothing is scheduled" is FALSE when only the DEVICE is
    // offline — the server is fine, booking.ts:578 is still firing on every
    // completion, and the queue is still sending. This is the same split the
    // settings banner forty lines up already makes, and the first draft of this
    // banner did not make it.
    expect(CLIENT).toMatch(/nothing can be sent from this tab while this persists/);
    expect(CLIENT).toMatch(/This device has not reached the server\. The shop's automation is unaffected/);
    // Exactly two shape-split banners on this page: settings and backfill.
    expect((CLIENT.match(/The shop's automation is unaffected/g) ?? []).length).toBe(2);
  });

  it("★ a STALE bookings table cannot survive an unknown read either", () => {
    // Same retained-data trap as the count: without this the operator sees a
    // table of named customers directly under em-dash tiles and a banner saying
    // the count is unknown.
    expect(CLIENT).toMatch(/\{!backfillUnknown && backfillPreview\?\.bookings && backfillPreview\.bookings\.length > 0 && \(/);
  });

  it("★ says the missing button does NOT mean the work is done", () => {
    // Hiding a dangerous control can imply exactly what the green tick used to
    // say. The copy has to close that reading explicitly, because the operator
    // sees an absence either way.
    expect(CLIENT).toMatch(/hidden because there is no count to authorise, not because everyone has been\s*\n?\s*contacted/);
    expect(CLIENT).toMatch(/unknown — not zero/);
  });
});
