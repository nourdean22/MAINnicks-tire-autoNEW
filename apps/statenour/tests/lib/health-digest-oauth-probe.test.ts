/**
 * A failed DB read must not tell the operator to re-grant a working token.
 *
 * `getGoogleOauthStatus` catches a `prisma.integration.findUnique` failure and
 * returns `state: "missing"` — the SAME state as a genuinely unconfigured
 * integration. Its `reason` was honest ("Integration table unreadable"), but
 * every consumer branches on the STATE and discards the reason:
 *
 *  - the health digest emitted the critical headline "Google OAuth not
 *    configured — Drive/Gmail/Calendar ingest disabled", linked to
 *    /api/oauth/google-data/start, sending the operator off to re-grant a token
 *    that is very likely fine;
 *  - the calendar cron returned `{ skipped: true, reason:
 *    "google_oauth_not_configured" }` — a GREEN cron row for a run that
 *    ingested nothing and blamed a configuration that is correct.
 *
 * Pinned on the extracted pure function rather than computeHealthDigest, which
 * fans out five prisma-touching scans in a Promise.all. That five-way mock is
 * exactly the cost that let this go unnoticed.
 */
import { describe, it, expect, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { integration: { findUnique } } }));

import { googleOauthHighlight } from "@/lib/system/health-digest";
import { getGoogleOauthStatus, type GoogleOauthStatus } from "@/lib/services/google-oauth";

function status(over: Partial<GoogleOauthStatus> = {}): GoogleOauthStatus {
  return {
    state: "healthy",
    lastSyncAt: "2026-08-04T00:00:00.000Z",
    consecutiveFailures: 0,
    email: "nour@example.com",
    reason: "",
    ...over,
  };
}

describe("googleOauthHighlight", () => {
  it("does NOT claim 'not configured' when the probe could not read the table", () => {
    const h = googleOauthHighlight(
      status({
        state: "missing",
        probeFailed: true,
        reason: "Integration table unreadable — check DB connectivity",
      }),
    );

    expect(h).not.toBeNull();
    expect(h!.headline).not.toMatch(/not configured/i);
    // The link is the actionable half of the defect: /start is a re-grant flow,
    // and there is nothing here to re-grant.
    expect(h!.link).not.toBe("/api/oauth/google-data/start");
    expect(h!.headline).toMatch(/unknown/i);
    // The honest reason the service already produced must survive to the surface.
    expect(h!.headline).toMatch(/unreadable/i);
  });

  it("downgrades it from critical to warning — this is not a Google outage", () => {
    const h = googleOauthHighlight(status({ state: "missing", probeFailed: true, reason: "x" }));
    expect(h!.severity).toBe("warning");
  });

  it("STILL emits the re-grant CTA when OAuth is genuinely not configured", () => {
    // Both directions. A fix that always says "unknown" would satisfy the cases
    // above while hiding a real, actionable setup gap.
    const h = googleOauthHighlight(
      status({
        state: "missing",
        probeFailed: false,
        reason: "Google OAuth not configured — grant Drive/Gmail/Calendar access",
      }),
    );

    expect(h!.severity).toBe("critical");
    expect(h!.headline).toMatch(/not configured/i);
    expect(h!.link).toBe("/api/oauth/google-data/start");
  });

  it("treats an ABSENT probeFailed as a genuine reading", () => {
    // The flag is optional and additive; a status minted by code that does not
    // set it must keep its old behaviour.
    const h = googleOauthHighlight(status({ state: "missing", reason: "not configured" }));
    expect(h!.severity).toBe("critical");
    expect(h!.link).toBe("/api/oauth/google-data/start");
  });

  it("keeps the expired and stale branches intact", () => {
    const expired = googleOauthHighlight(
      status({ state: "expired", consecutiveFailures: 3, reason: "r" }),
    );
    expect(expired!.severity).toBe("critical");
    expect(expired!.headline).toMatch(/3× refresh failures/);
    expect(expired!.link).toBe("/api/oauth/google-data/start");

    const stale = googleOauthHighlight(
      status({ state: "stale", reason: "ingest has not written rows in 9 days" }),
    );
    expect(stale!.severity).toBe("warning");
    expect(stale!.link).toBe("/system/health");
  });

  it("emits nothing when OAuth is healthy", () => {
    expect(googleOauthHighlight(status({ state: "healthy" }))).toBeNull();
  });
});

/**
 * The PRODUCER half.
 *
 * Without this block the whole fix is unpinned end to end: a mutation test
 * proved that deleting `probeFailed: true` from the service's catch left every
 * highlight assertion above green, because they construct the status object by
 * hand. Pinning only the consumer would have shipped a fix whose mechanism
 * nothing guards.
 */
describe("getGoogleOauthStatus sets probeFailed when it could not ASK", () => {
  it("marks probeFailed on an unreadable integration table", async () => {
    findUnique.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

    const out = await getGoogleOauthStatus();

    expect(out.probeFailed).toBe(true);
    // The state deliberately stays "missing" — the enum is consumed in several
    // places and widening it is a bigger change than this defect warrants. The
    // flag is what carries the distinction.
    expect(out.state).toBe("missing");
    expect(out.reason).toMatch(/unreadable/i);
  });

  it("does NOT mark probeFailed when the table is readable and simply has no row", async () => {
    // Both directions: a genuinely unconfigured integration must stay a real
    // "missing", or the re-grant CTA disappears when the operator needs it.
    findUnique.mockResolvedValueOnce(null);

    const out = await getGoogleOauthStatus();

    expect(out.probeFailed).toBeFalsy();
    expect(out.state).toBe("missing");
    expect(out.reason).toMatch(/not configured/i);
  });
});
