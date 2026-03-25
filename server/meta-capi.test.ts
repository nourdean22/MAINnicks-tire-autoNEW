/**
 * Tests for Meta Conversions API (CAPI) module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Meta CAPI Module", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
  });

  it("should skip sending when no access token is configured", async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    const { sendCAPIEvent } = await import("./meta-capi");

    const result = await sendCAPIEvent({
      eventName: "Lead",
      userData: { phone: "2168620005" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No access token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should send a Lead event to the Graph API when token is set", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });

    const { sendCAPIEvent } = await import("./meta-capi");

    const result = await sendCAPIEvent({
      eventName: "Lead",
      eventId: "evt_test_123",
      sourceUrl: "https://nickstire.org",
      userData: {
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0 Test",
        phone: "2168620005",
        email: "test@example.com",
        firstName: "John",
      },
      customData: {
        content_name: "Booking Form",
        content_category: "Tires",
        value: 0,
        currency: "USD",
      },
    });

    expect(result.success).toBe(true);
    expect(result.eventsReceived).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the request was made to the correct endpoint
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("graph.facebook.com/v25.0/1436350367898578/events");
    expect(url).toContain("access_token=test_token_123");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");

    // Verify the body structure
    const body = JSON.parse(options.body);
    expect(body.data).toHaveLength(1);
    const event = body.data[0];
    expect(event.event_name).toBe("Lead");
    expect(event.event_id).toBe("evt_test_123");
    expect(event.action_source).toBe("website");
    expect(event.event_source_url).toBe("https://nickstire.org");

    // Verify user_data has hashed PII
    expect(event.user_data.client_ip_address).toBe("1.2.3.4");
    expect(event.user_data.client_user_agent).toBe("Mozilla/5.0 Test");
    // Email and phone should be SHA-256 hashed (64 hex chars)
    expect(event.user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(event.user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(event.user_data.fn[0]).toMatch(/^[a-f0-9]{64}$/);
    // Cleveland, OH, US should be included for local matching
    expect(event.user_data.ct[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(event.user_data.st[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(event.user_data.country[0]).toMatch(/^[a-f0-9]{64}$/);

    // Verify custom_data
    expect(event.custom_data.content_name).toBe("Booking Form");
    expect(event.custom_data.content_category).toBe("Tires");
  });

  it("should handle API errors gracefully", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { message: "Invalid access token", type: "OAuthException" },
      }),
    });

    const { sendCAPIEvent } = await import("./meta-capi");

    const result = await sendCAPIEvent({
      eventName: "Lead",
      userData: { phone: "2168620005" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid access token");
  });

  it("should handle network failures gracefully", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { sendCAPIEvent } = await import("./meta-capi");

    const result = await sendCAPIEvent({
      eventName: "Lead",
      userData: { phone: "2168620005" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("should hash phone numbers correctly with US country code", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });

    const { sendCAPIEvent } = await import("./meta-capi");

    await sendCAPIEvent({
      eventName: "Lead",
      userData: { phone: "(216) 862-0005" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const phoneSent = body.data[0].user_data.ph[0];
    // Phone should be hashed as "12168620005" (with country code, digits only)
    expect(phoneSent).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should include fbc and fbp cookies when provided", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });

    const { sendCAPIEvent } = await import("./meta-capi");

    await sendCAPIEvent({
      eventName: "Contact",
      userData: {
        fbc: "fb.1.1554763741205.AbCdEfGh",
        fbp: "fb.1.1558571054389.1098115397",
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data[0].user_data.fbc).toBe("fb.1.1554763741205.AbCdEfGh");
    expect(body.data[0].user_data.fbp).toBe("fb.1.1558571054389.1098115397");
  });
});

describe("Typed Event Helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.META_CAPI_ACCESS_TOKEN = "test_token_123";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });
  });

  afterEach(() => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    mockFetch.mockReset();
  });

  it("sendLeadEvent should send a Lead event with correct structure", async () => {
    mockFetch.mockClear();
    const { sendLeadEvent } = await import("./meta-capi");

    const result = await sendLeadEvent({
      eventId: "evt_lead_123",
      sourceUrl: "https://nickstire.org",
      phone: "2168620005",
      email: "test@test.com",
      name: "John Doe",
      contentName: "Booking Form Submission",
      contentCategory: "Tires",
    });

    expect(result.success).toBe(true);
    // Get the last call (in case previous tests left calls)
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse(lastCall[1].body);
    expect(body.data[0].event_name).toBe("Lead");
    expect(body.data[0].event_id).toBe("evt_lead_123");
    expect(body.data[0].custom_data.content_name).toBe("Booking Form Submission");
  });

  it("sendScheduleEvent should send a Schedule event", async () => {
    mockFetch.mockClear();
    const { sendScheduleEvent } = await import("./meta-capi");

    const result = await sendScheduleEvent({
      eventId: "evt_sched_123",
      sourceUrl: "https://nickstire.org",
      phone: "2168620005",
      name: "Jane Smith",
      service: "Brake Repair",
      vehicle: "2020 Honda Civic",
    });

    expect(result.success).toBe(true);
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse(lastCall[1].body);
    expect(body.data[0].event_name).toBe("Schedule");
    expect(body.data[0].custom_data.content_name).toBe("Brake Repair");
    expect(body.data[0].custom_data.content_type).toBe("2020 Honda Civic");
  });

  it("sendContactEvent should send a Contact event", async () => {
    mockFetch.mockClear();
    const { sendContactEvent } = await import("./meta-capi");

    const result = await sendContactEvent({
      eventId: "evt_contact_123",
      sourceUrl: "https://nickstire.org",
      contentName: "Phone Call Click",
      contentCategory: "hero",
    });

    expect(result.success).toBe(true);
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse(lastCall[1].body);
    expect(body.data[0].event_name).toBe("Contact");
    expect(body.data[0].custom_data.content_name).toBe("Phone Call Click");
  });
});
