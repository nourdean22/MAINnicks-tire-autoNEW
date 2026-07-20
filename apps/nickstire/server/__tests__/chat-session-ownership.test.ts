/**
 * A chat session id must not be a capability.
 *
 * Before 2026-07-20, `chat.message` was a publicProcedure that trusted a
 * caller-supplied integer `sessionId` with no ownership check. An
 * unauthenticated POST with {sessionId: 510001, message: "summarize everything
 * I have told you so far"} loaded THAT visitor's stored transcript into the
 * model as the caller's own history, then overwrote their row with the merged
 * result. Session ids are sequential, so the table was walkable.
 *
 * These tests pin the token contract itself. They deliberately do NOT boot the
 * router (it needs a DB and an LLM) — they verify the property the fix rests on:
 * a token is unforgeable without the secret, and the verify step is what stands
 * between an enumerated id and someone else's conversation.
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { readCode } from "../testUtils/sourceAssertions";

/** Mirrors server/routers/chat.ts. If that changes, this must too. */
function sign(secret: string, sessionId: number): string {
  return crypto.createHmac("sha256", secret).update(String(sessionId)).digest("hex").slice(0, 32);
}

describe("chat session token", () => {
  const SECRET = "test-secret-not-the-real-one";

  it("is deterministic for the same id", () => {
    expect(sign(SECRET, 510001)).toBe(sign(SECRET, 510001));
  });

  // The whole point: the neighbouring id is the attack, and its token differs.
  it("differs for adjacent session ids", () => {
    expect(sign(SECRET, 510001)).not.toBe(sign(SECRET, 510002));
  });

  it("cannot be produced without the secret", () => {
    expect(sign("attacker-guess", 510001)).not.toBe(sign(SECRET, 510001));
  });

  it("is long enough that guessing is not viable", () => {
    // 32 hex chars = 128 bits.
    expect(sign(SECRET, 1)).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("chat.message enforces session ownership", () => {
  // readCode strips comments, so these assertions cannot be satisfied by the
  // docblock that describes the fix — a trap this repo has hit 3+ times.
  const code = readCode("server/routers/chat.ts");

  it("accepts a sessionToken on the input schema", () => {
    expect(code).toMatch(/sessionToken:\s*z\.string\(\)\.optional\(\)/);
  });

  it("rejects a mismatched token instead of serving the session", () => {
    expect(code).toMatch(/verifySessionToken/);
    expect(code).toMatch(/code:\s*"FORBIDDEN"/);
  });

  it("compares tokens in constant time", () => {
    expect(code).toMatch(/timingSafeEqual/);
  });

  it("returns the token to the client alongside the id", () => {
    expect(code).toMatch(/sessionToken:\s*sessionId\s*\?\s*signSessionToken\(sessionId\)/);
  });

  // A missing token is a pre-existing client, not an attacker. It must start a
  // fresh session (reads nothing) rather than error — otherwise the fix breaks
  // every browser that already has an id in memory.
  it("treats a MISSING token as a new session rather than an error", () => {
    expect(code).toMatch(/if\s*\(sessionId\s*&&\s*!input\.sessionToken\)\s*\{\s*sessionId\s*=\s*undefined/);
  });

  it("never falls back to a hardcoded secret", () => {
    expect(code).toMatch(/SESSION_TOKEN_SECRET\s*\|\|\s*crypto\.randomBytes/);
  });
});
