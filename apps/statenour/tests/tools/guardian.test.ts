/**
 * Guardian wrapper behavior corpus · v10.0.357
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({
    decision: "allow",
    riskClass: "low",
    reason: "mocked",
  }),
}));

import { classify, withGuardian, GuardianError } from "@/lib/tools/guardian";

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
