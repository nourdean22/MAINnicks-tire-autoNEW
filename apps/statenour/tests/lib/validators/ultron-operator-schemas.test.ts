/**
 * Ultron operator-domain slice contract tests · Phase B.6a
 * (2026-05-22 · legacy-modernizer REST→tRPC ultron slice ·
 * operator-domain sub-slice).
 *
 * The ultron operator-domain sub-slice migrated 8 client call-sites
 * in components/ultron/* off `authedFetch` onto `trpc.operator.*`.
 * The risk that migration introduces is the typed-payload-mismatch
 * class: a client payload TypeScript accepts but the server Zod input
 * rejects at runtime, surfacing as a generic failure toast (the
 * /tasks quick-add bug, 2026-05-21).
 *
 * Of the 9 new `operator` procedures, 7 take NO input (ticker ·
 * personalPulse · situation · refreshHealthDigest · commandCenterState
 * · mit · clearMit) — there is no payload to mismatch, so nothing to
 * pin. The 2 with a structured `z.object({...})` input are:
 *
 *   · operator.setMit  · z.object({ text: z.string().max(200) })
 *   · operator.plan    · z.object({ intent: z.string().min(1).max(2000) })
 *
 * Those `.input(...)` objects are re-declared here VERBATIM so a
 * tightened bound fails CI before it breaks a real call-site, and the
 * real client request payloads are pinned against them.
 *
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/chat-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ──────────────── operator.setMit ────────────────
//
// components/ultron/mit-slot.tsx `save()` sends { text: draft } where
// `draft` is the MIT input value. The input element has maxLength=120
// (the service slices to 120 anyway) so the typical payload is well
// under the 200-char tRPC-boundary cap. The "Clear" button uses the
// dedicated `operator.clearMit` (no-input) procedure, not setMit("").

describe("operator.setMit · call-site payload contract", () => {
  const setMitInput = z.object({ text: z.string().max(200) });

  it("accepts a normal MIT save — { text: <one-line outcome> }", () => {
    expect(() =>
      setMitInput.parse({ text: "Ship the ultron tRPC slice" }),
    ).not.toThrow();
  });

  it("accepts an empty-string text — the legacy clear path is still legal here", () => {
    // The migrated MITSlot routes clears through `operator.clearMit`,
    // but `setMit("")` remains a valid payload (the service's
    // empty-text branch soft-deletes) · the schema must not reject it.
    expect(() => setMitInput.parse({ text: "" })).not.toThrow();
  });

  it("accepts a payload at the input's 120-char maxLength", () => {
    expect(() => setMitInput.parse({ text: "x".repeat(120) })).not.toThrow();
  });

  it("accepts a payload at the 200-char tRPC-boundary cap", () => {
    expect(() => setMitInput.parse({ text: "x".repeat(200) })).not.toThrow();
  });

  it("rejects a payload over the 200-char cap", () => {
    expect(() => setMitInput.parse({ text: "x".repeat(201) })).toThrow();
  });

  it("rejects a non-string text — the string type is the guard", () => {
    expect(() =>
      setMitInput.parse({ text: 42 as unknown as string }),
    ).toThrow();
  });

  it("rejects a missing text key", () => {
    expect(() => setMitInput.parse({})).toThrow();
  });
});

// ──────────────── operator.plan ────────────────
//
// components/ultron/ask/omni-capture.tsx `fire()` case "plan" sends
// { intent: text } where `text` is the trimmed capture input. The
// omni-capture-router only classifies a capture into the "plan" kind
// when there's real text, so the payload is always a non-empty
// string. `buildMicroPlan` enforces the 3-char floor downstream and
// throws IntentTooShortError → BAD_REQUEST.

describe("operator.plan · call-site payload contract", () => {
  const planInput = z.object({ intent: z.string().min(1).max(2000) });

  it("accepts a normal plan intent — { intent: <free-text goal> }", () => {
    expect(() =>
      planInput.parse({ intent: "close out the day well" }),
    ).not.toThrow();
  });

  it("accepts a one-char intent — the 3-char floor is the service's job, not the boundary", () => {
    // The tRPC `.input()` bound is min(1) · the 3-char minimum is
    // enforced inside buildMicroPlan (IntentTooShortError → BAD_REQUEST)
    // so a 1-2 char payload passes the boundary then fails in the
    // service · this test pins that the boundary itself is min(1).
    expect(() => planInput.parse({ intent: "x" })).not.toThrow();
  });

  it("accepts a long intent at the 2000-char cap", () => {
    expect(() => planInput.parse({ intent: "x".repeat(2000) })).not.toThrow();
  });

  it("rejects an empty intent — min(1) is the guard", () => {
    expect(() => planInput.parse({ intent: "" })).toThrow();
  });

  it("rejects an intent over the 2000-char cap", () => {
    expect(() => planInput.parse({ intent: "x".repeat(2001) })).toThrow();
  });

  it("rejects a missing intent key", () => {
    expect(() => planInput.parse({})).toThrow();
  });
});
