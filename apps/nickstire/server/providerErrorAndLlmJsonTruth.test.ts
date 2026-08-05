/**
 * Two failures that ran silently in production until the operator noticed the
 * Instagram account had gone quiet. Both are the same shape as the ROS-083 arc:
 * the system knew something had gone wrong and said something else.
 *
 * ★ ONE — A BILLING WALL FILED AS A TRANSIENT BLIP.
 *
 * Reel job #1380001, 2026-08-04 18:03, failed with Higgsfield's:
 *   {"data":{"modal_data":{"elapsed_days":2},"type":"unlock_full_access_notice"},
 *    "error_type":"grace_daily_limit_reached"}
 *
 * That matched NONE of the eight classifier patterns — no "billing", no
 * "exhausted", and no "rate" for RATE_LIMIT — so it fell through to UNKNOWN,
 * whose policy is RETRY_BACKOFF and whose reason reads "unrecognised failure —
 * treated as transient, but review the message". The daily cron re-attempted
 * every day and nothing raised a human. The account still held 745 credits, so
 * no balance alarm could have fired either: a balance is not permission to
 * generate, and that is exactly why this needs its own signal.
 *
 * It must land on QUOTA_OR_CREDIT (PAUSE_PROVIDER), NOT RATE_LIMIT. RATE_LIMIT
 * is RETRY_WITHOUT_CONSUMING_ATTEMPT — built for a request refused before work
 * began that clears on its own. A grace-tier daily cap does not clear by
 * waiting and cannot be retried out of; it needs the operator to upgrade.
 *
 * ★ TWO — A TRUNCATED RESPONSE REPORTED AS A BACKTICK.
 *
 * ig_autopost_log, 2026-08-05 and 2026-08-01:
 *   Unexpected token '`', "```json\n{"... is not valid JSON
 *   Unterminated string in JSON at position 830
 *
 * Both are one root cause — the model's output was cut off mid-object — and
 * neither message says so. parseJsonObject's fence regex requires the CLOSING
 * ```, so on truncation it did not match; the brace isolation could not find a
 * balanced `}` either; and JSON.parse received text starting with the fence.
 * The error named the backtick, which is the one detail that does not matter.
 */
import { describe, it, expect } from "vitest";
import { classifyProviderError } from "../shared/providerErrors";
import { parseJsonObject } from "./services/igAutopost";

/** The exact stderr payload from prod reel job #1380001. */
const GRACE_LIMIT =
  'Higgsfield CLI exited with code 3. Stderr: Error: {"data":{"modal_data":{"elapsed_days":2},"type":"unlock_full_access_notice"},"error_type":"grace_daily_limit_reached"}';

describe("a plan-tier wall stops the provider instead of retrying forever", () => {
  it("classifies the exact prod payload as QUOTA_OR_CREDIT, not UNKNOWN", () => {
    const v = classifyProviderError(new Error(GRACE_LIMIT));
    expect(v.errorClass).toBe("QUOTA_OR_CREDIT");
    expect(v.errorClass).not.toBe("UNKNOWN");
  });

  it("PAUSES the provider so a human is raised — the whole point", () => {
    const v = classifyProviderError(new Error(GRACE_LIMIT));
    expect(v.action).toBe("PAUSE_PROVIDER");
    // RETRY_BACKOFF is what it did before: re-attempt daily, alert never.
    expect(v.action).not.toBe("RETRY_BACKOFF");
  });

  it("is NOT RATE_LIMIT — that would forgive the attempt and keep retrying", () => {
    // The tempting misclassification. RATE_LIMIT is
    // RETRY_WITHOUT_CONSUMING_ATTEMPT, which would burn the daily cron forever
    // against a wall only a plan upgrade removes.
    const v = classifyProviderError(new Error(GRACE_LIMIT));
    expect(v.action).not.toBe("RETRY_WITHOUT_CONSUMING_ATTEMPT");
    expect(v.consumesAttempt).toBe(true);
  });

  it("covers the sibling plan-wall wordings providers actually send", () => {
    for (const msg of [
      "error_type: grace_daily_limit_reached",
      "daily_limit_reached",
      "unlock_full_access",
      "upgrade_required to continue",
      "trial_expired",
      "subscription_required",
    ]) {
      expect(classifyProviderError(new Error(msg)).errorClass).toBe("QUOTA_OR_CREDIT");
    }
  });

  it("leaves every other class where it was — no collateral reclassification", () => {
    expect(classifyProviderError(new Error("HTTP 429 rate limit")).errorClass).toBe("RATE_LIMIT");
    expect(classifyProviderError(new Error("401 unauthorized")).errorClass).toBe("AUTH_INVALID");
    expect(classifyProviderError(new Error("blocked by content_policy")).errorClass).toBe("SAFETY_POLICY_PERMANENT");
    expect(classifyProviderError(new Error("ECONNRESET")).errorClass).toBe("TRANSIENT_NETWORK");
    expect(classifyProviderError(new Error("ffmpeg died")).errorClass).toBe("STORAGE_OR_ASSEMBLY");
    expect(classifyProviderError(new Error("something nobody has seen")).errorClass).toBe("UNKNOWN");
  });
});

describe("a truncated LLM response says it was truncated", () => {
  it("no longer blames a backtick when the fence is unclosed", () => {
    // The literal prod shape: opening fence, object begins, output stops.
    const truncated = '```json\n{"caption":"Winter tires are on and the fir';
    expect(() => parseJsonObject(truncated)).toThrow(/truncated/i);
    expect(() => parseJsonObject(truncated)).not.toThrow(/Unexpected token/);
  });

  it("reports how much arrived, so the fix (raise max_tokens) is obvious", () => {
    const truncated = '```json\n{"caption":"' + "x".repeat(400);
    expect(() => parseJsonObject(truncated)).toThrow(/raise max_tokens/i);
    expect(() => parseJsonObject(truncated)).toThrow(new RegExp(`${truncated.length} chars`));
  });

  it("still parses a properly fenced object — the happy path is untouched", () => {
    const ok = '```json\n{"caption":"hello","hashtags":["a"]}\n```';
    expect(parseJsonObject<{ caption: string }>(ok).caption).toBe("hello");
  });

  it("still parses a bare object, and one wrapped in prose", () => {
    expect(parseJsonObject<{ a: number }>('{"a":1}').a).toBe(1);
    expect(parseJsonObject<{ a: number }>('Sure! Here you go:\n{"a":2}\nHope that helps.').a).toBe(2);
  });

  it("wraps a genuine syntax error too, rather than leaking the raw parser text", () => {
    // Braces balance, so this is malformed rather than truncated — a different
    // message, but still one that names the call instead of the character.
    expect(() => parseJsonObject('{"a":,}')).toThrow(/was not valid JSON/i);
  });
});
