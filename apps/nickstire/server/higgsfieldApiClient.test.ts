/**
 * The Higgsfield API-key lane — mocked HTTP, no network, no spend.
 *
 * WHY THIS EXISTS. The Higgsfield CLI SESSION lane went dead for four days
 * (2026-08-13 -> 08-17) because a refresh token was revoked, and the operator
 * does not fully control what revokes it: OAuth refresh tokens are single-use,
 * so a second client on the same account silently strands the first
 * (docs/runbooks/higgsfield-session.md §3). This module talks to Higgsfield's
 * OFFICIAL REST API with a static key instead — no session, nothing to revoke.
 *
 * These tests exercise the wire protocol against `fetch`, mocked per-call, so a
 * change to the request shape or the auth header is caught the same way a real
 * server's rejection would be caught — not by grepping for a string.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateReelClipVideoViaApi,
  higgsfieldApiCredentialsFromEnv,
  probeHiggsfieldApiCredentials,
} from "./services/higgsfieldApiClient";

const CREDS = { keyId: "kid_test", keySecret: "sk_test_secret" };

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      status: r.status,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
}

describe("higgsfieldApiCredentialsFromEnv", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  it("requires BOTH vars — one alone is not configured", () => {
    process.env.HIGGSFIELD_API_KEY_ID = "kid";
    delete process.env.HIGGSFIELD_API_KEY_SECRET;
    expect(higgsfieldApiCredentialsFromEnv()).toBeNull();

    delete process.env.HIGGSFIELD_API_KEY_ID;
    process.env.HIGGSFIELD_API_KEY_SECRET = "secret";
    expect(higgsfieldApiCredentialsFromEnv()).toBeNull();
  });

  it("empty-string env vars do not count as configured", () => {
    process.env.HIGGSFIELD_API_KEY_ID = "  ";
    process.env.HIGGSFIELD_API_KEY_SECRET = "sk";
    expect(higgsfieldApiCredentialsFromEnv()).toBeNull();
  });

  it("both set and non-empty resolves to the credentials", () => {
    process.env.HIGGSFIELD_API_KEY_ID = "kid_1";
    process.env.HIGGSFIELD_API_KEY_SECRET = "sk_1";
    expect(higgsfieldApiCredentialsFromEnv()).toEqual({ keyId: "kid_1", keySecret: "sk_1" });
  });
});

describe("probeHiggsfieldApiCredentials — free, no generation, three-state answer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a 404 on a garbage id means the key WORKS — the server authenticated the request", async () => {
    global.fetch = mockFetchSequence([{ status: 404, body: { error: "not found" } }]);
    const r = await probeHiggsfieldApiCredentials(CREDS);
    expect(r.healthy).toBe(true);
  });

  it("401/403 means the key is WRONG, distinctly from unknown", async () => {
    global.fetch = mockFetchSequence([{ status: 401, body: { error: "unauthorized" } }]);
    const r = await probeHiggsfieldApiCredentials(CREDS);
    expect(r.healthy).toBe(false);
    expect(r.reason).toMatch(/key rejected/);
  });

  it("an unexpected status is UNKNOWN, never guessed as healthy or dead", async () => {
    global.fetch = mockFetchSequence([{ status: 500, body: { error: "upstream" } }]);
    const r = await probeHiggsfieldApiCredentials(CREDS);
    expect(r.healthy).toBeNull();
  });

  it("network failure is UNKNOWN, not false — a transport blip must not read as a dead key", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await probeHiggsfieldApiCredentials(CREDS);
    expect(r.healthy).toBeNull();
    expect(r.reason).toContain("ECONNRESET");
  });

  it("no credentials at all is UNKNOWN, with a reason naming which vars are missing", async () => {
    const r = await probeHiggsfieldApiCredentials({ keyId: "", keySecret: "" });
    expect(r.healthy).toBeNull();
    expect(r.reason).toContain("HIGGSFIELD_API_KEY_ID");
  });
});

describe("generateReelClipVideoViaApi — the request shape and the auth header", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the OFFICIAL auth scheme: Authorization: Key <id>:<secret>", async () => {
    const calls: RequestInit[] = [];
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_1" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_1", video: { url: "https://cdn.example/clip.mp4" } }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    await generateReelClipVideoViaApi({ prompt: "a brake pad wearing thin" }, { pollIntervalMs: 1 });

    const submitHeaders = calls[0].headers as Record<string, string>;
    expect(submitHeaders.Authorization).toBe(`Key ${CREDS.keyId}:${CREDS.keySecret}`);
    // Never the third-party apidog.com scheme — that document contradicts the
    // official docs and was rejected as a source for exactly this reason.
    expect(submitHeaders.Authorization).not.toMatch(/^Bearer /);
  });

  it("posts to the DoP endpoint with model + prompt, and input_images only when a start image is given", async () => {
    const bodies: unknown[] = [];
    global.fetch = vi.fn(async (url, init: RequestInit) => {
      if (init.method === "POST") bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1 && init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_2" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_2", video: { url: "https://cdn.example/clip2.mp4" } }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    await generateReelClipVideoViaApi(
      { prompt: "battery in cold weather", startImageUrl: "https://example.com/frame.jpg" },
      { pollIntervalMs: 1 },
    );

    const submitCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(submitCall[0]).toContain("/higgsfield-ai/dop/standard");
    expect(bodies[0]).toMatchObject({
      model: "dop-standard",
      prompt: "battery in cold weather",
      input_images: [{ type: "image_url", image_url: "https://example.com/frame.jpg" }],
    });
  });

  it("polls until a TERMINAL status, ignoring in-progress states", async () => {
    let pollCount = 0;
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_3" }) } as Response;
      }
      pollCount++;
      if (pollCount < 3) {
        return { status: 200, text: async () => JSON.stringify({ status: "processing", request_id: "req_3" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_3", video: { url: "https://cdn.example/done.mp4" } }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    const url = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 });
    expect(url).toBe("https://cdn.example/done.mp4");
    expect(pollCount).toBe(3);
  });

  it("a 'failed' terminal status throws, naming the request id for reconciliation", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_4" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "failed", request_id: "req_4", error: "content policy" }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    await expect(generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }))
      .rejects.toThrow(/req_4/);
  });

  it("a transient non-2xx poll response is retried, not fatal", async () => {
    let pollCount = 0;
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_5" }) } as Response;
      }
      pollCount++;
      if (pollCount === 1) return { status: 502, text: async () => "bad gateway" } as Response;
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_5", video: { url: "https://cdn.example/ok.mp4" } }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    const url = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 });
    expect(url).toBe("https://cdn.example/ok.mp4");
  });

  it("times out on a hard wall clock rather than polling forever, and does not silently claim a cancel", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_6" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "processing", request_id: "req_6" }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;

    // `generateReelClipVideoViaApi` floors timeoutMs at 60_000 (Math.max), the
    // same floor the CLI lane uses, so a real clock would burn ~60s here. Fake
    // timers drive the deadline check without the wait — this covers the
    // FLOOR itself (an opts.timeoutMs of 1 must still take the full 60s to
    // fire), not a shortcut around it.
    vi.useFakeTimers();
    try {
      const p = expect(
        generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1_000, timeoutMs: 1 }),
      ).rejects.toThrow(/timed out.*req_6.*NOT cancelled/s);
      await vi.advanceTimersByTimeAsync(65_000);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to run with no credentials configured, before making any request", async () => {
    delete process.env.HIGGSFIELD_API_KEY_ID;
    delete process.env.HIGGSFIELD_API_KEY_SECRET;
    const spy = vi.fn();
    global.fetch = spy;
    await expect(generateReelClipVideoViaApi({ prompt: "x" })).rejects.toThrow(/not configured/);
    expect(spy).not.toHaveBeenCalled();
  });
});
