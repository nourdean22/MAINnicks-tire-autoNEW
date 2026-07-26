/**
 * Guardian wrapper behavior corpus · v10.0.357
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({
    decision: "allow",
    riskClass: "low",
    reason: "mocked",
  }),
}));

import {
  classify,
  withGuardian,
  GuardianError,
  __resetGuardianBreakers,
} from "@/lib/tools/guardian";

describe("classify · failure categorization", () => {
  it("auth_expired on 401", () => {
    expect(classify({ status: 401, message: "x" })).toBe("auth_expired");
  });
  it("auth_expired on 403", () => {
    expect(classify({ status: 403 })).toBe("auth_expired");
  });
  it("rate_limit on 429", () => {
    expect(classify({ status: 429, message: "too many requests" })).toBe("rate_limit");
  });
  it("api_timeout on AbortError", () => {
    expect(classify({ name: "AbortError", message: "" })).toBe("api_timeout");
  });
  it("api_timeout on 'timed out' message", () => {
    expect(classify(new Error("connection timed out"))).toBe("api_timeout");
  });
  it("network_failure on 'fetch failed'", () => {
    expect(classify(new Error("fetch failed"))).toBe("network_failure");
  });
  it("truncated_json on 'unexpected end of json'", () => {
    expect(classify(new Error("Unexpected end of JSON input"))).toBe("truncated_json");
  });
  it("schema_mismatch on 'missing required'", () => {
    expect(classify(new Error("missing required field id"))).toBe("schema_mismatch");
  });
  it("error_as_200 when result has .error", () => {
    expect(classify(null, { error: "oops" })).toBe("error_as_200");
  });
  it("unknown for anything else", () => {
    expect(classify(new Error("something weird"))).toBe("unknown");
  });
});

describe("withGuardian · happy path", () => {
  it("passes result through when fn succeeds first try", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const guarded = withGuardian("test", fn, { maxRetries: 2 });
    expect(await guarded(5)).toBe(10);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withGuardian · retries on transient errors", () => {
  it("retries once and succeeds on a network failure", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed");
      return "ok";
    };
    const guarded = withGuardian("test", fn, { maxRetries: 2 });
    expect(await guarded()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries on rate_limit then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error("too many requests"), { status: 429 });
      return "ok";
    };
    const guarded = withGuardian("test", fn, { maxRetries: 2 });
    expect(await guarded()).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("withGuardian · gives up after maxRetries", () => {
  it("throws GuardianError after exhausting retries", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    const guarded = withGuardian("test", fn, { maxRetries: 2 });
    await expect(guarded()).rejects.toBeInstanceOf(GuardianError);
    expect(calls).toBe(3); // initial + 2 retries
  });
});

describe("withGuardian · non-retryable errors fail fast", () => {
  it("auth_expired throws immediately, no retry", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    };
    const guarded = withGuardian("test", fn, { maxRetries: 3 });
    await expect(guarded()).rejects.toMatchObject({ category: "auth_expired" });
    expect(calls).toBe(1);
  });

  it("schema_mismatch fails fast, no retry", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("missing required field");
    };
    const guarded = withGuardian("test", fn, { maxRetries: 3 });
    await expect(guarded()).rejects.toMatchObject({ category: "schema_mismatch" });
    expect(calls).toBe(1);
  });
});

describe("withGuardian · error-as-200 detection", () => {
  it("detects { error: ... } in returned result", async () => {
    const fn = async () => ({ error: "secret thing went wrong" });
    const guarded = withGuardian("test", fn, { maxRetries: 0 });
    await expect(guarded()).rejects.toMatchObject({ category: "error_as_200" });
  });

  it("supports custom error-as-200 detector", async () => {
    const fn = async () => ({ ok: false, code: "X" });
    const guarded = withGuardian("test", fn, {
      maxRetries: 0,
      isErrorAs200: (r) => Boolean(r && typeof r === "object" && (r as { ok?: boolean }).ok === false),
    });
    await expect(guarded()).rejects.toMatchObject({ category: "error_as_200" });
  });
});

describe("withGuardian · schema validation", () => {
  it("throws on schema fail with no retry", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return { wrongShape: true };
    };
    const guarded = withGuardian("test", fn, {
      maxRetries: 2,
      validateSchema: (r) => Boolean((r as { id?: string })?.id),
    });
    await expect(guarded()).rejects.toMatchObject({ category: "schema_mismatch" });
    expect(calls).toBe(1);
  });
});

describe("withGuardian · circuit breaker", () => {
  beforeEach(() => {
    __resetGuardianBreakers();
  });

  it("opens after N consecutive backend failures and fast-fails without calling fn", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("fetch failed"); // → network_failure (a tripping category)
    };
    const guarded = withGuardian("cb-open", fn, {
      reliabilityOnly: true,
      maxRetries: 0,
      breakerThreshold: 3,
      breakerCooldownMs: 10_000,
    });

    // 3 real failures trip the breaker; fn is called each time.
    for (let i = 0; i < 3; i++) {
      await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    }
    expect(calls).toBe(3);

    // 4th call is fast-failed by the open breaker — fn is NOT invoked.
    await expect(guarded()).rejects.toMatchObject({ category: "circuit_open" });
    expect(calls).toBe(3);
  });

  it("half-open probe after cooldown: a success resets the breaker", async () => {
    let calls = 0;
    let mode: "fail" | "ok" = "fail";
    const fn = async () => {
      calls++;
      if (mode === "fail") throw new Error("fetch failed");
      return { ok: true };
    };
    const guarded = withGuardian("cb-halfopen", fn, {
      reliabilityOnly: true,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 40,
    });

    // Trip it (2 failures), confirm the 3rd fast-fails.
    await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    await expect(guarded()).rejects.toMatchObject({ category: "circuit_open" });
    expect(calls).toBe(2);

    // Let the cooldown elapse, flip to success — the next call probes and resets.
    await new Promise((r) => setTimeout(r, 60));
    mode = "ok";
    await expect(guarded()).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(3); // the probe ran

    // Breaker is closed again: one fresh failure must NOT immediately re-open.
    mode = "fail";
    await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    expect(calls).toBe(4);
  });

  it("does NOT trip on auth failures (config error, not a down backend)", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    };
    const guarded = withGuardian("cb-auth", fn, {
      reliabilityOnly: true,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 10_000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(guarded()).rejects.toMatchObject({ category: "auth_expired" });
    }
    // Breaker never opened — every call reached fn.
    expect(calls).toBe(5);
  });

  it("half-open admits exactly ONE probe under concurrent fan-out (no thundering herd)", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      // stay down; slow enough that all concurrent probes would overlap
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("fetch failed");
    };
    // 2026-07-25 · the cooldown must be WIDE relative to how long the
    // fan-out takes to schedule. claimBreakerSlot re-arms openUntil to
    // `now + cooldownMs`, so if the event loop stalls longer than the
    // cooldown between the first and last item of the Promise.allSettled
    // batch, a SECOND caller finds the window elapsed and claims a second
    // probe — `calls - callsAfterTrip` becomes 2 and the test fails.
    // The old 30ms cooldown gave no margin: the fan-out alone measures
    // ~121ms locally, and on a contended 2-core CI runner (forks pool)
    // it reliably tripped a second window. 1s is far beyond any plausible
    // scheduling stall inside a ~20ms batch. Assertions below UNCHANGED.
    const guarded = withGuardian("cb-herd", fn, {
      reliabilityOnly: true,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 1_000,
    });

    // Trip the breaker (2 sequential failures).
    await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    const callsAfterTrip = calls; // 2

    // Let the cooldown elapse, then fire 10 concurrent calls at once.
    await new Promise((r) => setTimeout(r, 1_200));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guarded()));

    // Exactly ONE became the probe (reached fn); the other 9 were fast-failed.
    expect(calls - callsAfterTrip).toBe(1);
    const circuitOpen = results.filter(
      (r) => r.status === "rejected" && (r.reason as GuardianError)?.category === "circuit_open",
    );
    expect(circuitOpen.length).toBe(9);
  });

  it("circuitBreaker:false disables the breaker entirely", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    const guarded = withGuardian("cb-disabled", fn, {
      reliabilityOnly: true,
      maxRetries: 0,
      circuitBreaker: false,
      breakerThreshold: 2,
    });

    for (let i = 0; i < 5; i++) {
      await expect(guarded()).rejects.toMatchObject({ category: "network_failure" });
    }
    expect(calls).toBe(5); // no fast-fail, breaker disabled
  });
});
