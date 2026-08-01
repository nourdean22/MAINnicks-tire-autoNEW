import { describe, it, expect } from "vitest";
import {
  classifyProviderError,
  nextStatusFor,
  stampError,
  parseErrorClass,
} from "./providerErrors";

/**
 * The reel worker used to send EVERY failure back to `queued` until
 * MAX_ATTEMPTS. These lock the cases where that policy actively cost money or
 * hid an operator problem.
 */
const MAX = 3;

describe("classification by message", () => {
  const cases: Array<[string, string]> = [
    ["Veo submit failed: blocked by responsible AI filters", "SAFETY_POLICY_PERMANENT"],
    ["HTTP 403 permission denied", "AUTH_INVALID"],
    ["Run: hf auth login", "AUTH_INVALID"],
    ["insufficient credits for this generation", "QUOTA_OR_CREDIT"],
    ["HTTP 429 too many requests", "RATE_LIMIT"],
    ["400 invalid argument: unsupported aspect ratio", "PROMPT_INVALID"],
    ["ffmpeg exited with code 1", "STORAGE_OR_ASSEMBLY"],
    ["operation failed: internal error", "REMOTE_FAILED"],
    ["ECONNRESET while downloading", "TRANSIENT_NETWORK"],
    ["something nobody has seen before", "UNKNOWN"],
  ];

  for (const [msg, expected] of cases) {
    it(`"${msg.slice(0, 38)}" -> ${expected}`, () => {
      expect(classifyProviderError(new Error(msg)).errorClass).toBe(expected);
    });
  }

  it("prefers the safety block over the generic failure wording it ships with", () => {
    // Providers wrap policy rejections in 400s. Reading the 400 first would
    // demote a permanent block to "patch the request and retry".
    const v = classifyProviderError(new Error("400 invalid request: content policy violation"));
    expect(v.errorClass).toBe("SAFETY_POLICY_PERMANENT");
    expect(v.action).toBe("REGENERATE_PROMPT");
  });
});

describe("a local timeout is classified by what we HOLD, not what it says", () => {
  it("with an operation id, resume the same op — never resubmit", () => {
    const v = classifyProviderError(new Error("poll beat 2 timed out"), {
      isLocalTimeout: true,
      hasRemoteOperationId: true,
    });
    expect(v.errorClass).toBe("LOCAL_TIMEOUT_REMOTE_RUNNING");
    expect(v.action).toBe("RESUME_OPERATION");
    expect(v.mayDoubleSpend).toBe(false);
    expect(v.consumesAttempt).toBe(false);
  });

  it("without one, the remote may still be running and billing", () => {
    const v = classifyProviderError(new Error("poll beat 2 timed out"), {
      isLocalTimeout: true,
      hasRemoteOperationId: false,
    });
    expect(v.errorClass).toBe("LOCAL_TIMEOUT_REMOTE_UNKNOWN");
    expect(v.action).toBe("RECONCILE_BEFORE_RETRY");
    expect(v.mayDoubleSpend).toBe(true);
  });

  it("is the ONLY class flagged as possible double spend", () => {
    const all = [
      "Veo blocked by safety", "403 forbidden", "429 rate limit", "ECONNRESET",
      "ffmpeg failed", "operation failed", "400 invalid argument", "no credits",
    ].map((m) => classifyProviderError(new Error(m)));
    expect(all.some((v) => v.mayDoubleSpend)).toBe(false);
  });
});

describe("recovery routing", () => {
  it("a rate limit does not consume an attempt", () => {
    const v = classifyProviderError(new Error("429 rate limit"));
    const next = nextStatusFor(v, 2, MAX, "queued");
    expect(next.status).toBe("queued");
    expect(next.attempts).toBe(1); // handed back
    expect(next.terminal).toBe(false);
  });

  it("an auth failure goes terminal immediately instead of burning the budget", () => {
    // Three identical 403s teach nothing and delay the operator alert.
    const v = classifyProviderError(new Error("401 unauthorized"));
    const next = nextStatusFor(v, 1, MAX, "queued");
    expect(next.status).toBe("failed");
    expect(next.terminal).toBe(true);
  });

  it("an ambiguous timeout parks instead of retrying into a second charge", () => {
    const v = classifyProviderError(new Error("timed out"), { isLocalTimeout: true });
    const next = nextStatusFor(v, 1, MAX, "queued");
    expect(next.status).toBe("failed");
    expect(next.terminal).toBe(true);
  });

  it("a transient failure still retries normally up to the cap", () => {
    const v = classifyProviderError(new Error("ECONNRESET"));
    expect(nextStatusFor(v, 1, MAX, "queued").status).toBe("queued");
    expect(nextStatusFor(v, 3, MAX, "queued").status).toBe("failed");
  });

  it("never returns a status longer than the varchar(20) column", () => {
    // A 32-char status would throw "data too long" from inside the failure
    // handler and strand the job in `generating`.
    for (const m of ["429 rate limit", "401 unauthorized", "ECONNRESET", "ffmpeg failed"]) {
      const v = classifyProviderError(new Error(m));
      expect(nextStatusFor(v, 1, MAX, "queued").status.length).toBeLessThanOrEqual(20);
    }
    const amb = classifyProviderError(new Error("t"), { isLocalTimeout: true });
    expect(nextStatusFor(amb, 1, MAX, "queued").status.length).toBeLessThanOrEqual(20);
  });
});

describe("error stamping stays greppable", () => {
  it("round-trips the class through the stored message", () => {
    const v = classifyProviderError(new Error("blocked by safety filters"));
    const stamped = stampError(v, "blocked by safety filters");
    expect(parseErrorClass(stamped)).toBe("SAFETY_POLICY_PERMANENT");
    expect(stamped).toContain("blocked by safety filters");
  });

  it("survives truncation to the error column width at the prefix", () => {
    const v = classifyProviderError(new Error("x".repeat(5000)));
    expect(parseErrorClass(stampError(v, "x".repeat(5000)).slice(0, 1000))).toBe("UNKNOWN");
  });
});
