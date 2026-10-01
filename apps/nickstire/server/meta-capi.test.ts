/**
 * Tests for server/meta-capi.ts — pins the safety contracts of the
 * restored-dormant implementation:
 *  1. NO TOKEN => zero network calls, quiet {success:false} (dormant)
 *  2. WITH TOKEN => PII is SHA-256 hashed (em/ph), never sent raw
 *  3. event_id passes through for pixel<->CAPI dedup
 *  4. Graph API errors are swallowed into {success:false} — never thrown
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { withRetry } from "./retry";

const ORIGINAL_FETCH = global.fetch;

function mockFetchOk() {
  const calls: Array<{ url: string; body: any }> = [];
  global.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ events_received: 1 }) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("meta-capi", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.META_CAPI_ACCESS_TOKEN;
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.META_CAPI_ACCESS_TOKEN;
  });

  it("DORMANT: without META_CAPI_ACCESS_TOKEN no network call is made", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendLeadEvent } = await import("./meta-capi");
    const result = await sendLeadEvent({
      phone: "2165551234",
      name: "Test Person",
      contentName: "Lead Form Submission",
      contentCategory: "popup",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/META_CAPI_ACCESS_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ACTIVE: phone + email are SHA-256 hashed, never sent raw", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-real";
    const calls = mockFetchOk();
    const { sendLeadEvent } = await import("./meta-capi");
    const result = await sendLeadEvent({
      phone: "(216) 555-1234",
      email: "Customer@Example.com",
      name: "Test Person",
      contentName: "Lead Form Submission",
      contentCategory: "popup",
    });
    expect(result.success).toBe(true);
    const event = calls[0].body.data[0];
    const raw = JSON.stringify(calls[0].body);
    // Raw PII must never appear anywhere in the payload
    expect(raw).not.toContain("2165551234");
    expect(raw).not.toContain("customer@example.com");
    expect(raw).not.toContain("Test Person");
    // Hashes must match Meta spec (normalized, lowercased, sha256 hex)
    const phoneHash = crypto.createHash("sha256").update("12165551234").digest("hex");
    const emailHash = crypto.createHash("sha256").update("customer@example.com").digest("hex");
    expect(event.user_data.ph).toEqual([phoneHash]);
    expect(event.user_data.em).toEqual([emailHash]);
  });

  it("ACTIVE: event_id passes through for pixel<->CAPI dedup", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-real";
    const calls = mockFetchOk();
    const { sendLeadEvent } = await import("./meta-capi");
    await sendLeadEvent({
      eventId: "evt_test_dedup123",
      phone: "2165551234",
      contentName: "Lead",
      contentCategory: "popup",
    });
    expect(calls[0].body.data[0].event_id).toBe("evt_test_dedup123");
  });

  it("ACTIVE: Graph API errors are swallowed into success:false, never thrown", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-real";
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    })) as unknown as typeof fetch;
    const { sendLeadEvent } = await import("./meta-capi");
    const result = await sendLeadEvent({
      phone: "2165551234",
      contentName: "Lead",
      contentCategory: "popup",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid OAuth access token");
    expect(result.retryable).toBe(false);
    expect(result.httpStatus).toBe(401);
  });

  it("RETRY CONTRACT: transient Graph failures reject through the adapter and retry", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-real";
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: "temporary Meta outage" } }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ events_received: 1 }),
      } as Response;
    }) as unknown as typeof fetch;

    const { requireCapiDelivery, sendLeadEvent } = await import("./meta-capi");
    const result = await withRetry(
      () => requireCapiDelivery(sendLeadEvent({
        phone: "2165551234",
        contentName: "Lead",
        contentCategory: "popup",
      })),
      { maxRetries: 1, baseDelayMs: 0, label: "capi-test" },
    );

    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it("RETRY CONTRACT: missing configuration is terminal and does not burn retries", async () => {
    let attempts = 0;
    const { requireCapiDelivery, sendLeadEvent } = await import("./meta-capi");

    await expect(withRetry(
      () => {
        attempts++;
        return requireCapiDelivery(sendLeadEvent({
          phone: "2165551234",
          contentName: "Lead",
          contentCategory: "popup",
        }));
      },
      { maxRetries: 3, baseDelayMs: 0, label: "capi-test" },
    )).rejects.toThrow(/META_CAPI_ACCESS_TOKEN/);

    expect(attempts).toBe(1);
  });
});
