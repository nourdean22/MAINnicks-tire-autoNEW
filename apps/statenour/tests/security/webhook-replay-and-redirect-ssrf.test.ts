/**
 * tests/security/webhook-replay-and-redirect-ssrf.test.ts
 * 2026-09-02 deep-research audit · findings C-6 and C-7
 *
 * Two controls that were each half-implemented:
 *
 * C-7 · The Stripe signature check parsed the `t=` timestamp, folded it into
 *   the signed payload, and never compared it to the clock. The timestamp is
 *   the half of the protocol that bounds REPLAY; without it a captured
 *   request stays valid forever. (Duplicate fulfilment was separately blocked
 *   by a unique constraint on stripeSessionId — a different guarantee, and
 *   one that does not extend to future event types.)
 *
 * C-6 · The Telegram link handler asserted the URL was public exactly once,
 *   then fetched it with the default `redirect: "follow"`. A public URL that
 *   answers 302 → cloud metadata therefore bypassed the gate it had just
 *   passed. The sibling `ingestDocumentFromUrl` had been hardened against
 *   this precise bypass; the fix never propagated.
 *
 * Both halves are tested here: the refusal AND the positive control that a
 * legitimate request still succeeds. A gate that rejects everything would
 * otherwise score green while breaking payments and link previews.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import { verifyStripeSignature, STRIPE_TOLERANCE_SECONDS } from "@/lib/security/stripe-signature";
import { fetchPublicUrl } from "@/lib/utils/url-safety";

const SECRET = "whsec_test_do_not_use";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

function signedHeader(timestampSeconds: number, secret = SECRET, payload = PAYLOAD): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

describe("C-7 · Stripe webhook signatures expire", () => {
  const NOW = 1_800_000_000;

  it("positive control · a correctly signed, fresh request is accepted", () => {
    expect(verifyStripeSignature(PAYLOAD, signedHeader(NOW), SECRET, NOW)).toBe(true);
  });

  it("accepts a request at the edge of the tolerance window", () => {
    const edge = NOW - STRIPE_TOLERANCE_SECONDS;
    expect(verifyStripeSignature(PAYLOAD, signedHeader(edge), SECRET, NOW)).toBe(true);
  });

  it("rejects a replay one second past the window, though its signature is valid", () => {
    // The signature here is genuinely correct — this is the whole point. Only
    // the clock distinguishes it from the accepted case above.
    const stale = NOW - STRIPE_TOLERANCE_SECONDS - 1;
    const header = signedHeader(stale);
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, stale)).toBe(true); // valid when fresh
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).toBe(false); // replayed later
  });

  it("rejects a far-future timestamp as symmetrically as an old one", () => {
    const future = NOW + STRIPE_TOLERANCE_SECONDS + 1;
    expect(verifyStripeSignature(PAYLOAD, signedHeader(future), SECRET, NOW)).toBe(false);
  });

  it("rejects a non-numeric timestamp instead of coercing it", () => {
    const v1 = createHmac("sha256", SECRET).update(`abc.${PAYLOAD}`).digest("hex");
    expect(verifyStripeSignature(PAYLOAD, `t=abc,v1=${v1}`, SECRET, NOW)).toBe(false);
  });

  it("accepts when the matching v1 is NOT first — the secret-rotation case", () => {
    // Stripe signs with BOTH secrets during a rolling change and sends
    // several v1 entries. The original code (and my first fix) took
    // parts.find(v1=), i.e. only the first, so a receiver would reject live
    // webhooks for the whole rotation window and look like an outage.
    const good = signedHeader(NOW);
    const goodV1 = good.split("v1=")[1];
    const decoy = "a".repeat(goodV1.length);
    const rotating = `t=${NOW},v1=${decoy},v1=${goodV1}`;
    expect(verifyStripeSignature(PAYLOAD, rotating, SECRET, NOW)).toBe(true);
  });

  it("rejects when NO v1 entry matches, however many are offered", () => {
    const decoy = "b".repeat(64);
    expect(verifyStripeSignature(PAYLOAD, `t=${NOW},v1=${decoy},v1=${decoy}`, SECRET, NOW)).toBe(false);
  });

  it("still rejects a tampered payload inside the window", () => {
    const header = signedHeader(NOW);
    expect(verifyStripeSignature(PAYLOAD + " ", header, SECRET, NOW)).toBe(false);
  });
});

describe("C-6 · fetchPublicUrl re-asserts the SSRF gate on every redirect hop", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks a public URL that redirects into cloud metadata", async () => {
    // example.com passes the gate; its 302 target does not. The single-check
    // version fetched this happily.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
      ),
    );

    const result = await fetchPublicUrl("https://example.com/redirector");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("url_blocked");
      expect(result.reason).toMatch(/private_ipv4_literal/);
    }
  });

  it("positive control · a plain 200 is returned, and a normal redirect is followed", async () => {
    // Without this half, a helper that refused everything would pass the test
    // above while silently breaking every link preview.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://example.org/final" } }))
      .mockResolvedValueOnce(new Response("hello", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicUrl("https://example.com/start");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://example.org/final");
      expect(await result.response.text()).toBe("hello");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a private URL before making any request at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchPublicUrl("http://127.0.0.1:11434/api/tags");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects a redirect loop rather than spinning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } })),
    );
    const result = await fetchPublicUrl("https://example.com/loop");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("redirect_loop");
  });

  it("stops after the hop cap instead of following a redirect chain forever", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: `https://example.com/hop${n++}` } })),
    );
    const result = await fetchPublicUrl("https://example.com/start", {}, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_many_hops");
  });
});
