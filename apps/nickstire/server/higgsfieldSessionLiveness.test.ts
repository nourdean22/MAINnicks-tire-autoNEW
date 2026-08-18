/**
 * PRESENCE IS NOT LIVENESS - the defect this helper exists to stop repeating.
 *
 * A revoked refresh token leaves the credentials blob perfectly intact, so
 * `!!getHiggsfieldCredentialsJson()` reported "configured" through a four-day dead
 * session (#1628). The same shape reappeared as `dbReachable` on the API-key lane
 * (P2, #1653): a truthy value proving only that something was SET.
 *
 * These drive the helper against a mocked cron_log and assert the STATE, including
 * the case that matters most - UNKNOWN must never render as dead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEEPALIVE = "higgsfield-session-keepalive";

describe("higgsfieldSessionLiveness reads the keepalive verdict, not the blob", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("./lib/db-helper");
    vi.doUnmock("./services/higgsfieldStudio");
    vi.resetModules();
  });

  /** Mocks db-helper so the final `limit()` resolves to the given rows. */
  const mockRows = (rows: unknown[]) =>
    vi.doMock("./lib/db-helper", () => ({
      db: async () => ({
        select: () => ({
          from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
        }),
      }),
    }));

  const load = async () => (await import("./services/higgsfieldStudio")).higgsfieldSessionLiveness();

  it("a FAILED keepalive is live:false, and carries the reason", async () => {
    mockRows([{ status: "failed", details: "Higgsfield keepalive FAILED - re-login required (refresh token revoked)", errorMessage: null, startedAt: new Date(), ageMinutes: 2 }]);
    const r = await load();
    expect(r.live).toBe(false);
    expect(r.reason).toMatch(/revoked/i);
  });

  it("a COMPLETED keepalive is live:true and parses the credit balance", async () => {
    // The balance is the only account credit figure this app can read - the API
    // lane has no balance endpoint (every GET returns 405).
    mockRows([{ status: "completed", details: "session refreshed, 2986 credits", errorMessage: null, startedAt: new Date(), ageMinutes: 3 }]);
    const r = await load();
    expect(r.live).toBe(true);
    expect(r.balanceCredits).toBe(2986);
  });

  it("a STALE verdict is UNKNOWN (null), never dead", async () => {
    // The keepalive runs every 15 min. An hour-old verdict is not evidence, and
    // "has not run" needs a different response from "is dead". Age comes from the
    // DATABASE, so this fixture states it directly rather than faking a clock.
    mockRows([{ status: "completed", details: "session refreshed, 2986 credits", errorMessage: null, startedAt: new Date(), ageMinutes: 60 }]);
    const r = await load();
    expect(r.live).toBeNull();
    expect(r.reason).toMatch(/stale|old/i);
    // The balance is still reported - it is the last KNOWN figure, just aged.
    expect(r.balanceCredits).toBe(2986);
  });

  it("age is computed SERVER-SIDE, because the driver skews DATETIME by the local offset", async () => {
    // MEASURED 2026-08-18: mysql2 parses DATETIME in the connection's local zone
    // while this DB returns UTC, so a parsed `startedAt` landed 4 HOURS IN THE
    // FUTURE on an ET machine (DB NOW() read 20:10 when true UTC was 16:10). The
    // first version of this helper derived age as `Date.now() - startedAt`, which
    // goes NEGATIVE under that skew - so every stale verdict within the offset read
    // as FRESH, the precise opposite of the guard's purpose.
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "server/services/higgsfieldStudio.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function higgsfieldSessionLiveness"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("TIMESTAMPDIFF(MINUTE");
    expect(body).toContain("UTC_TIMESTAMP()");
    // The skewed derivation must not come back.
    expect(body).not.toContain("Date.now() - checkedAt");
  });

  it("an age the DB could not compute is UNKNOWN, not assumed fresh", async () => {
    // Assuming fresh is how a stale verdict becomes a confident one.
    mockRows([{ status: "completed", details: "session refreshed, 10 credits", errorMessage: null, startedAt: new Date(), ageMinutes: null }]);
    const r = await load();
    expect(r.live).toBeNull();
    expect(r.reason).toMatch(/could not compute/i);
  });

  it("MySQL returning the age as a STRING still works", async () => {
    // Computed columns commonly arrive as strings from mysql2.
    mockRows([{ status: "completed", details: "session refreshed, 7 credits", errorMessage: null, startedAt: new Date(), ageMinutes: "5" }]);
    const r = await load();
    expect(r.live).toBe(true);
    expect(r.balanceCredits).toBe(7);
  });

  it("NO keepalive row at all is UNKNOWN, not dead", async () => {
    mockRows([]);
    const r = await load();
    expect(r.live).toBeNull();
    expect(r.reason).toMatch(/never recorded/i);
  });

  it("an unreadable database is UNKNOWN, not dead", async () => {
    vi.doMock("./lib/db-helper", () => ({
      db: async () => ({
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => { throw new Error("ECONNREFUSED"); } }) }) }) }),
      }),
    }));
    const r = await load();
    expect(r.live).toBeNull();
    expect(r.reason).toMatch(/could not read/i);
  });

  it("no database handle is UNKNOWN, not dead", async () => {
    vi.doMock("./lib/db-helper", () => ({ db: async () => null }));
    const r = await load();
    expect(r.live).toBeNull();
    expect(r.reason).toMatch(/no database handle/i);
  });

  it("it queries the KEEPALIVE job specifically, newest first", async () => {
    // A helper that read some other job's row, or an arbitrary row, would produce a
    // confident verdict about the wrong thing.
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "server/services/higgsfieldStudio.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function higgsfieldSessionLiveness"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain(`"${KEEPALIVE}"`);
    expect(body).toContain("desc(cronLog.startedAt)");
    expect(body).toContain("limit(1)");
  });
});

describe("the health surfaces use liveness, not presence", () => {
  const read = () =>
    (require("node:fs") as typeof import("node:fs")).readFileSync(
      (require("node:path") as typeof import("node:path")).resolve(process.cwd(), "server/routers/instagramAdmin.ts"),
      "utf8",
    );

  it("getPipelineHealth decides the higgsfield branch on hfSession.live === true", () => {
    const src = read();
    const fn = src.slice(src.indexOf("getPipelineHealth"), src.indexOf("getProviderHealth"));
    expect(fn).toContain("hfSession.live === true");
    // The old presence check must not be what decides `configured` any more.
    expect(fn).not.toMatch(/\? higgsfieldConfigured\s*\n?\s*:/);
  });

  it("getProviderHealth does too, and still reports presence separately", () => {
    const src = read();
    const fn = src.slice(src.indexOf("getProviderHealth"));
    expect(fn).toContain('imageProvider === "higgsfield" ? hfSession.live === true');
    // Presence is still exposed - it is genuinely useful ("blob present but session
    // dead" is the actionable state) - just no longer mistaken for health.
    expect(fn).toContain("higgsfieldCreds,");
  });
});
