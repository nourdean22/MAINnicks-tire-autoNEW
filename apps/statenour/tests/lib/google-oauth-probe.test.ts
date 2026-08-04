/**
 * "Not configured" and "we could not ask" must not be the same answer.
 *
 * `isGoogleOauthConfigured` collapsed a missing refresh token and an unreadable
 * integration table into the same `false`. Callers then reported a
 * CONFIGURATION problem on evidence about our own database — the same defect
 * #1348 fixed one level up in getGoogleOauthStatus, living one function down.
 *
 * The worst consumer was the Drive cron: `{ skipped: true, reason:
 * "google_oauth_not_configured" }` is filed as a SUCCESSFUL run, so a database
 * outage became a green cron row blaming a grant that was fine.
 *
 * BOTH HALVES ARE PINNED. #1348 taught this the hard way: pinning only the
 * consumer left the producer free to stop setting the flag with every test
 * still green. The producer cases here are the ones that would catch that.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { integration: { findUnique }, auditEvent: { create: vi.fn() } },
}));
// drive-ingest imports these at module scope; the probe returns before any of
// them is called, but they still have to resolve.
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/services/drive-api", () => ({
  listRecentFiles: vi.fn(),
  getFileMetadata: vi.fn(),
  getFileContent: vi.fn(),
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import {
  probeGoogleOauthConfigured,
  isGoogleOauthConfigured,
} from "@/lib/services/google-oauth";
import { runDriveIngest } from "@/lib/brain/drive-ingest";

beforeEach(() => {
  findUnique.mockReset();
});

describe("probeGoogleOauthConfigured — the producer", () => {
  it("marks probeFailed when the integration table is unreadable", async () => {
    findUnique.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

    const out = await probeGoogleOauthConfigured();

    expect(out.probeFailed).toBe(true);
    expect(out.configured).toBe(false);
    // The reason must point at the DB, not at Google — this string is what the
    // operator reads before deciding whether to re-grant.
    expect(out.reason).toMatch(/unreadable/i);
    expect(out.reason).toMatch(/NOT the Google grant/i);
  });

  it("does NOT mark probeFailed when the table is readable and has no row", async () => {
    // Both directions. A genuinely unconfigured integration must stay a real
    // "not configured", or the setup CTA vanishes when it is actually needed.
    findUnique.mockResolvedValueOnce(null);

    const out = await probeGoogleOauthConfigured();

    expect(out.probeFailed).toBe(false);
    expect(out.configured).toBe(false);
    expect(out.reason).toMatch(/not configured/i);
  });

  it("distinguishes a row that exists but stores no refresh token", async () => {
    findUnique.mockResolvedValueOnce({ config: { accessToken: "a" } });

    const out = await probeGoogleOauthConfigured();

    expect(out.probeFailed).toBe(false);
    expect(out.configured).toBe(false);
    expect(out.reason).toMatch(/no refresh token/i);
  });

  it("reports configured when a refresh token is stored", async () => {
    findUnique.mockResolvedValueOnce({ config: { refreshToken: "r" } });

    const out = await probeGoogleOauthConfigured();

    expect(out.configured).toBe(true);
    expect(out.probeFailed).toBe(false);
  });
});

describe("isGoogleOauthConfigured — unchanged for its six callers", () => {
  it("still returns a plain boolean, still false on an unreadable table", async () => {
    findUnique.mockRejectedValueOnce(new Error("db down"));
    const out = await isGoogleOauthConfigured();
    expect(out).toBe(false);
    expect(typeof out).toBe("boolean");
  });

  it("still returns true when configured", async () => {
    findUnique.mockResolvedValueOnce({ config: { refreshToken: "r" } });
    expect(await isGoogleOauthConfigured()).toBe(true);
  });
});

describe("runDriveIngest — the consumer that files cron outcomes", () => {
  it("does NOT blame the Google grant when the probe could not read the table", async () => {
    findUnique.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

    const out = await runDriveIngest();

    expect(out.probeFailed).toBe(true);
    // The reason the cron files must not be the configuration one.
    expect(out.reason).toBe("google_oauth_status_unreadable");
    expect(out.reason).not.toBe("google_oauth_not_configured");
    expect(out.hint).toMatch(/do NOT re-grant/i);
    expect(out.stored).toBe(0);
  });

  it("STILL reports the ordinary not-configured skip when that is the truth", async () => {
    // Both directions: the graceful skip exists so an ungranted integration
    // does not file a failed cron row every run. That must survive.
    findUnique.mockResolvedValueOnce(null);

    const out = await runDriveIngest();

    expect(out.probeFailed).toBeFalsy();
    expect(out.reason).toBe("google_oauth_not_configured");
    expect(out.hint).toMatch(/google-data\/start/);
  });
});
