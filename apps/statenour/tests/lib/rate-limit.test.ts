import { checkRateLimit, getClientIp, checkAiRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first 3 requests", () => {
    const key = `test-allow-${Date.now()}`;
    const config = { windowMs: 1000, max: 3 };

    const r1 = checkRateLimit(key, config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, config);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, config);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks the 4th request in same window", () => {
    const key = `test-block-${Date.now()}`;
    const config = { windowMs: 60000, max: 3 };

    checkRateLimit(key, config);
    checkRateLimit(key, config);
    checkRateLimit(key, config);

    const r4 = checkRateLimit(key, config);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("allows again with a different key", () => {
    const config = { windowMs: 1000, max: 3 };
    const freshKey = `test-fresh-${Date.now()}`;

    const result = checkRateLimit(freshKey, config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("remaining decreases with each call", () => {
    const key = `test-decrement-${Date.now()}`;
    const config = { windowMs: 60000, max: 5 };

    const r1 = checkRateLimit(key, config);
    const r2 = checkRateLimit(key, config);
    const r3 = checkRateLimit(key, config);

    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
    expect(r3.remaining).toBe(2);
  });
});

describe("getClientIp", () => {
  // v10.0.529 S-4 fix · the extractor now walks x-forwarded-for from
  // the right (closest to trust boundary) and skips private hops so an
  // attacker can't spoof the rate-limit-key by injecting fake hops.

  it("prefers x-vercel-forwarded-for (platform-trusted, unspoofable)", () => {
    const req = new Request("http://localhost/api/test", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    // Vercel-trusted header wins even when x-forwarded-for is set.
    expect(getClientIp(req)).toBe("203.0.113.7");
  });

  it("takes the LAST non-private hop from x-forwarded-for", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "198.51.100.5, 10.0.0.1, 192.168.1.1" },
    });
    // The two trailing hops are private (internal proxy chain) · the
    // leftmost public IP is the real client.
    expect(getClientIp(req)).toBe("198.51.100.5");
  });

  it("treats an all-private x-forwarded-for chain as 'unknown' (not a spoof opening)", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
    });
    // Pre-fix returned "192.168.1.1" (first hop). Post-fix correctly
    // refuses to trust a chain that's purely private — defeats the
    // bucket-rotation spoof from S-4.
    expect(getClientIp(req)).toBe("unknown");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-real-ip": "203.0.113.42" },
    });
    expect(getClientIp(req)).toBe("203.0.113.42");
  });

  it('returns "unknown" when no IP headers present', () => {
    const req = new Request("http://localhost/api/test");
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("v9.1.19 · checkAiRateLimit", () => {
  it("returns null when under the limit (allowed)", () => {
    const req = new Request(
      `http://localhost/api/v9.1.19-allow-${Date.now()}`,
      { headers: { "x-forwarded-for": "10.0.0.1" } },
    );
    expect(checkAiRateLimit(req)).toBeNull();
  });

  it("returns a 429 Response after the AI cap (10/min) is hit", () => {
    // Burn 10 by calling the underlying limiter 10 times with the
    // same composed key (path + ip) checkAiRateLimit uses.
    const path = `/api/v9.1.19-block-${Date.now()}`;
    const ip = "10.9.9.9";
    const headers = { "x-forwarded-for": ip };
    for (let i = 0; i < 10; i++) {
      const req = new Request(`http://localhost${path}`, { headers });
      const r = checkAiRateLimit(req);
      expect(r).toBeNull(); // first 10 allowed
    }
    const req11 = new Request(`http://localhost${path}`, { headers });
    const blocked = checkAiRateLimit(req11);
    expect(blocked).toBeInstanceOf(Response);
    expect(blocked!.status).toBe(429);
  });

  it("the 429 Response carries Retry-After + JSON body", async () => {
    const path = `/api/v9.1.19-shape-${Date.now()}`;
    const ip = "10.8.8.8";
    const headers = { "x-forwarded-for": ip };
    for (let i = 0; i < 10; i++) {
      checkAiRateLimit(new Request(`http://localhost${path}`, { headers }));
    }
    const blocked = checkAiRateLimit(
      new Request(`http://localhost${path}`, { headers }),
    );
    expect(blocked).toBeInstanceOf(Response);
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
    expect(blocked!.headers.get("Content-Type")).toContain("application/json");
    const body = await blocked!.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(typeof body.retryAfterMs).toBe("number");
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("uses path+IP as the dedup key — two paths from same IP are independent", () => {
    const ip = "10.7.7.7";
    const headers = { "x-forwarded-for": ip };
    const pathA = `/api/v9.1.19-pathA-${Date.now()}`;
    const pathB = `/api/v9.1.19-pathB-${Date.now()}`;
    // Hammer pathA to its cap.
    for (let i = 0; i < 10; i++) {
      checkAiRateLimit(new Request(`http://localhost${pathA}`, { headers }));
    }
    expect(
      checkAiRateLimit(new Request(`http://localhost${pathA}`, { headers })),
    ).toBeInstanceOf(Response);
    // pathB from the same IP should still be open — separate key.
    expect(
      checkAiRateLimit(new Request(`http://localhost${pathB}`, { headers })),
    ).toBeNull();
  });

  it("two different IPs hit the same path independently", () => {
    const path = `/api/v9.1.19-multi-ip-${Date.now()}`;
    // Burn IP1.
    for (let i = 0; i < 10; i++) {
      checkAiRateLimit(
        new Request(`http://localhost${path}`, {
          headers: { "x-forwarded-for": "1.1.1.1" },
        }),
      );
    }
    expect(
      checkAiRateLimit(
        new Request(`http://localhost${path}`, {
          headers: { "x-forwarded-for": "1.1.1.1" },
        }),
      ),
    ).toBeInstanceOf(Response);
    // IP2 still has its own bucket.
    expect(
      checkAiRateLimit(
        new Request(`http://localhost${path}`, {
          headers: { "x-forwarded-for": "2.2.2.2" },
        }),
      ),
    ).toBeNull();
  });
});
