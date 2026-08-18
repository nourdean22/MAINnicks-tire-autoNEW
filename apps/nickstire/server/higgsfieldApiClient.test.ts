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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateReelClipVideoViaApi,
  higgsfieldApiCredentialsFromEnv,
  REEL_CLIP_DEFAULTS,
  HiggsfieldApiSubmittedError,
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


describe("SPEND SAFETY: a submitted generation must never be retried elsewhere", () => {
  // Found by the render-spend-trajectory gate, not by me. DoP has no resumable
  // handle, so regenerating a clip after a POST-SUBMIT failure pays twice for one
  // beat — the recorded history of this vendor is literally "re-submitting is what
  // doubled the paid spend on every timeout". Pre-submit failures spent nothing
  // and are safe to fall back on. The error TYPE is what carries that distinction
  // to the caller, so these tests pin the type, not just the message.
  afterEach(() => vi.restoreAllMocks());

  function creds() {
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;
  }

  it("a POST-SUBMIT timeout throws HiggsfieldApiSubmittedError carrying the request id", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_spend_1" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "processing", request_id: "req_spend_1" }) } as Response;
    });
    creds();
    vi.useFakeTimers();
    try {
      const p = generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1_000, timeoutMs: 1 });
      const assertion = expect(p).rejects.toBeInstanceOf(HiggsfieldApiSubmittedError);
      await vi.advanceTimersByTimeAsync(65_000);
      await assertion;
      await p.catch((e: unknown) => {
        expect((e as HiggsfieldApiSubmittedError).requestId).toBe("req_spend_1");
        expect((e as HiggsfieldApiSubmittedError).spendMayHaveOccurred).toBe(true);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a POST-SUBMIT 'failed' status is also submitted-typed — the credit may still be spent", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_spend_2" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "failed", request_id: "req_spend_2", error: "policy" }) } as Response;
    });
    creds();
    await expect(generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(HiggsfieldApiSubmittedError);
  });

  it("a completed-but-URL-less response is submitted-typed — it definitely billed", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_spend_3" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_spend_3" }) } as Response;
    });
    creds();
    await expect(generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(HiggsfieldApiSubmittedError);
  });

  it("PRE-SUBMIT failures are PLAIN errors, so the caller may safely fall back", async () => {
    // A non-2xx submit means nothing was queued and nothing can bill.
    global.fetch = vi.fn(async () => ({ status: 500, text: async () => JSON.stringify({ error: "upstream" }) }) as Response);
    creds();
    const err = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HiggsfieldApiSubmittedError);
  });

  it("a submit that returns no request_id is PRE-SUBMIT — there is no id that could bill", async () => {
    global.fetch = vi.fn(async () => ({ status: 200, text: async () => JSON.stringify({ status: "queued" }) }) as Response);
    creds();
    const err = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(HiggsfieldApiSubmittedError);
    expect((err as Error).message).toMatch(/no request_id/);
  });

  it("the submitted error TELLS the caller not to regenerate, in words", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_spend_4" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "processing", request_id: "req_spend_4" }) } as Response;
    });
    creds();
    vi.useFakeTimers();
    try {
      const p = generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1_000, timeoutMs: 1 });
      const assertion = expect(p).rejects.toThrow(/paid for twice/);
      await vi.advanceTimersByTimeAsync(65_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the free probe is REACHABLE — an unrunnable safety check is not one", () => {
  // This shipped with ZERO callers: exported, named in the runbook as "the
  // intended first step", and invocable only by hand-writing TypeScript. That is
  // the built-tested-unwired defect this arc has now found four times — the reel
  // shadow-judge readout, higgsfieldSessionHealth, buildDraftWorkspace, and then
  // my own probe. These pin the two reachable entry points so it cannot silently
  // become unreachable again.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("a CLI probe script exists and reads the SAME source generation reads", () => {
    // This asserted the env-only reader until 2026-08-18. That was the bug: the
    // probe reported "configured: NO" for a key correctly stored in app_secret_kv,
    // telling the operator their save had failed when it had succeeded. A
    // verification tool reading a different source than the code it verifies is
    // not a verification tool.
    const src = read("scripts/probe-higgsfield-api-key.mts");
    expect(src).toContain("probeHiggsfieldApiCredentials");
    expect(src).toContain("getHiggsfieldApiCredentials");
    // And it must load .env, or db() is null and "could not look" prints as
    // "not configured" — unknown rendered as absent.
    expect(src).toContain("loadEnvFromDotenv");
    // It must distinguish those two states rather than collapsing them.
    expect(src).toContain("dbReachable");
    expect(src).toMatch(/configured: UNKNOWN/);
  });

  it("that script DOES force-exit, because it now holds a mysql pool", () => {
    // REVERSED 2026-08-18, and the reversal is the lesson. This asserted the
    // opposite while the probe opened no DB: then it only had undici's closing
    // socket, and forcing the exit produced a libuv UV_HANDLE_CLOSING assertion —
    // cosmetic noise under a verdict line. Once the key moved to app_secret_kv the
    // probe opens a POOL, which never drains on its own, and setting exitCode alone
    // made the script HANG with zero output. A hang is strictly worse than one line
    // of stderr noise, and every sibling probe force-exits for this exact reason.
    const src = read("scripts/probe-higgsfield-api-key.mts");
    expect(src).toMatch(/process\.exit\(0\)/);
  });

  it("the admin health procedure reports BOTH lanes and names the one that wins", () => {
    // Reporting only the CLI session would describe a mechanism the pipeline is
    // not using once the key is set; reporting both without saying which is
    // authoritative would leave the operator to infer it, and inferring it wrong
    // is how a dead session read as fine for four days.
    const src = read("server/routers/instagramAdmin.ts");
    expect(src).toContain("probeHiggsfieldApiCredentials");
    expect(src).toContain("preferredLane");
    expect(src).toMatch(/api_key/);
    expect(src).toMatch(/cli_session/);
  });

  it("the health procedure skips the probe when no key is set — no cost, no change", () => {
    // Reads the DB-AWARE resolver: this assertion originally named the env-only
    // one, which was correct until the key became settable from the admin UI. A
    // caller left on the env resolver would be blind to a pasted key.
    const src = read("server/routers/instagramAdmin.ts");
    expect(src).toContain("await getHiggsfieldApiCredentials()");
    expect(src).toMatch(/configured: false/);
  });
});

describe("the API key is settable from the PHONE, not just a Railway env var", () => {
  // WHY: an env var needs Railway access and a redeploy that measured ~20 minutes
  // to reach the container. A DB row is pasted from Instagram -> Settings and takes
  // effect immediately, because the write clears the cache. For an operator whose
  // reel lane is down, that is a 60-second fix versus a deploy cycle. Same reason
  // the CLI credential blob already lives in app_secret_kv.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("the resolver prefers the DB and falls back to env", () => {
    const src = read("server/services/higgsfieldApiClient.ts");
    const fn = src.slice(src.indexOf("export async function getHiggsfieldApiCredentials"));
    expect(fn).toContain("higgsfield_api_key_id");
    expect(fn).toContain("higgsfield_api_key_secret");
    // env is the FALLBACK, reached via the env-only resolver
    expect(fn).toContain("higgsfieldApiCredentialsFromEnv()");
  });

  it("it requires BOTH rows — a half-configured key would 401 and read as 'wrong key'", () => {
    const src = read("server/services/higgsfieldApiClient.ts");
    const fn = src.slice(src.indexOf("export async function getHiggsfieldApiCredentials"));
    expect(fn).toContain("if (id && secret)");
  });

  it("the mutation accepts both fields and CLEARS the cache, or the paste would not take effect", () => {
    const src = read("server/routers/instagramAdmin.ts");
    expect(src).toContain("higgsfieldApiKeyId");
    expect(src).toContain("higgsfieldApiKeySecret");
    expect(src).toContain('k: "higgsfield_api_key_id"');
    expect(src).toContain('k: "higgsfield_api_key_secret"');
    // The invalidation is the whole point — getHiggsfieldApiCredentials latches.
    expect(src).toContain("clearRuntimeHiggsfieldApiKeyCache");
  });

  it("the Settings UI masks the secret and reports whether one is already stored", () => {
    const ui = read("client/src/pages/admin/instagram/Settings.tsx");
    expect(ui).toContain("higgsfieldApiKeySecret");
    expect(ui).toContain('type="password"');
    expect(ui).toContain("hasHiggsfieldApiKey");
  });

  it("every generation/health caller reads the DB-aware resolver, not the env-only one", () => {
    // If a caller kept the env-only resolver, a pasted key would be invisible to it
    // — the built-tested-unwired shape, one level down.
    for (const f of [
      "server/services/higgsfieldStudio.ts",
      "server/services/socialDeliveryIssues.ts",
      "server/routers/instagramAdmin.ts",
    ]) {
      const src = read(f);
      expect(src, f).toContain("getHiggsfieldApiCredentials");
      expect(src, f).not.toContain("higgsfieldApiCredentialsFromEnv()");
    }
  });
});

describe("the submit path is a KNOWN unknown, and self-corrects", () => {
  // MEASURED 2026-08-17: the server checks auth BEFORE routing. A POST to
  // /higgsfield-ai/definitely-not-real with a bogus key returns
  // 401 {"detail":"Invalid credentials"} — identical to a real path. So no free
  // probe can establish whether a path exists, and the docs
  // (/higgsfield-ai/dop/standard, by analogy with the documented soul/standard)
  // disagree with the official Node SDK (/v1/image2video/dop). Rather than ship a
  // coin flip, submit tries both. A 404 costs nothing: auth already succeeded, so
  // nothing was queued and nothing was billed.
  afterEach(() => vi.restoreAllMocks());
  const creds = () => {
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;
  };

  it("a 404 on the documented path FALLS THROUGH to the SDK path", async () => {
    const tried: string[] = [];
    global.fetch = vi.fn(async (url, init: RequestInit) => {
      const u = String(url);
      if (init.method === "POST") {
        tried.push(u);
        if (u.includes("/higgsfield-ai/dop/standard")) {
          return { status: 404, text: async () => JSON.stringify({ detail: "Not Found" }) } as Response;
        }
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_fb" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_fb", video: { url: "https://cdn/x.mp4" } }) } as Response;
    });
    creds();
    const url = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 });
    expect(url).toBe("https://cdn/x.mp4");
    expect(tried[0]).toContain("/higgsfield-ai/dop/standard");
    expect(tried[1]).toContain("/v1/image2video/dop");
  });

  it("a 404 fallback does NOT count as a submitted spend — nothing was queued", async () => {
    // The critical safety interaction: falling through on a 404 must not be
    // confused with retrying after a real submit, which would double-bill.
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        return { status: 404, text: async () => JSON.stringify({ detail: "Not Found" }) } as Response;
      }
      return { status: 200, text: async () => "{}" } as Response;
    });
    creds();
    const err = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    // Every candidate 404'd -> a PATH error, and explicitly NOT submitted-typed.
    expect(err).not.toBeInstanceOf(HiggsfieldApiSubmittedError);
    expect((err as Error).message).toMatch(/no candidate DoP path exists/);
    expect((err as Error).message).toMatch(/PATH problem/);
  });

  it("a NON-404 rejection stops immediately instead of shopping the other path", async () => {
    // A 400 means the right endpoint rejected a bad body. Trying the other path
    // would hide the real error and could submit the same job twice.
    let posts = 0;
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        posts++;
        return { status: 400, text: async () => JSON.stringify({ detail: "bad prompt" }) } as Response;
      }
      return { status: 200, text: async () => "{}" } as Response;
    });
    creds();
    const err = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect(posts, "a 400 must not trigger a second submit").toBe(1);
    expect((err as Error).message).toMatch(/HTTP 400/);
  });

  it("the error names the paths it tried, so the fix is one log line away", async () => {
    global.fetch = vi.fn(async (_url, init: RequestInit) =>
      init.method === "POST"
        ? ({ status: 404, text: async () => "{}" } as Response)
        : ({ status: 200, text: async () => "{}" } as Response));
    creds();
    const err = await generateReelClipVideoViaApi({ prompt: "x" }, { pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect((err as Error).message).toContain("/higgsfield-ai/dop/standard -> 404");
    expect((err as Error).message).toContain("/v1/image2video/dop -> 404");
  });
});

describe("the GENERATOR itself resolves credentials from the DB", () => {
  // P1 REVIEW, 2026-08-17, and the worst defect in this arc: generateReelClipVideoViaApi
  // resolved credentials with the ENV-ONLY reader. With the env vars unset — the
  // phone-only configuration this whole lane exists for — the caller's check passed
  // on the DB key, this threw "not configured", and generateReelClipVideo fell
  // through to the legacy CLI lane. A key pasted into Settings would never have
  // generated anything: the feature was defeated one layer below where I "fixed" it.
  //
  // My earlier test asserted the three CALLER files used the DB-aware resolver and
  // EXCLUDED this file from the loop, so the only place that actually resolves
  // credentials was never checked. These tests assert the resolution path itself.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("the generator awaits the DB-aware resolver, not the env-only one", () => {
    const src = read("server/services/higgsfieldApiClient.ts");
    const fn = src.slice(src.indexOf("export async function generateReelClipVideoViaApi"));
    const body = fn.slice(0, fn.indexOf("const body:"));
    expect(body).toContain("await getHiggsfieldApiCredentials()");
    // Anchored on the CALL, so the explanatory comment naming the old reader
    // cannot satisfy or break this — the mistake this session made four times.
    expect(body).not.toContain("= higgsfieldApiCredentialsFromEnv();");
  });

  it("the probe's default also resolves through the DB", () => {
    const src = read("server/services/higgsfieldApiClient.ts");
    const fn = src.slice(src.indexOf("export async function probeHiggsfieldApiCredentials"));
    const body = fn.slice(0, fn.indexOf("try {"));
    expect(body).toContain("await getHiggsfieldApiCredentials()");
  });

  it("a FAILED db load does not permanently latch — the DB is retried", () => {
    // P2 review: apiCredsLoadAttempted was set BEFORE the query, so one outage
    // pinned it true with a null cache and every later call skipped the DB
    // forever. A transient fault must not become a permanent blind spot.
    const src = read("server/services/higgsfieldApiClient.ts");
    const fn = src.slice(
      src.indexOf("export async function getHiggsfieldApiCredentials"),
      src.indexOf("export interface DopVideoRequest"),
    );
    const latchAt = fn.indexOf("apiCredsLoadAttempted = true;");
    const catchAt = fn.indexOf("} catch (err) {");
    expect(latchAt, "the latch must exist").toBeGreaterThan(-1);
    // The latch must sit INSIDE the try, before the catch — i.e. only on a
    // completed query — not above it.
    expect(latchAt).toBeLessThan(catchAt);
    expect(fn.slice(0, fn.indexOf("try {"))).not.toContain("apiCredsLoadAttempted = true;");
  });

  it("generation reports the DB-or-Settings path in its not-configured error", () => {
    const src = read("server/services/higgsfieldApiClient.ts");
    expect(src).toMatch(/Settings.*app_secret_kv|app_secret_kv.*Settings/s);
  });
});

describe("the clip FORMAT matches the lane that has actually shipped reels", () => {
  // The API lane shipped passing no aspect ratio, no duration and no resolution,
  // while buildSeedanceArgs — which produced every reel this shop has published —
  // passes `--aspect_ratio 9:16 --duration 4 --resolution 1080p`. reelAssembly
  // THROWS unless a clip is 1080x1920, so DoP defaults would have produced clips
  // that failed the render gate AFTER being paid for. Clip length also feeds the
  // 15-22s total-duration target, so a default duration silently changes reel
  // length depending on which lane ran.
  afterEach(() => vi.restoreAllMocks());

  async function submitAndCaptureBody(req: Parameters<typeof generateReelClipVideoViaApi>[0]) {
    let body: Record<string, unknown> = {};
    global.fetch = vi.fn(async (_url, init: RequestInit) => {
      if (init.method === "POST") {
        body = JSON.parse(init.body as string);
        return { status: 200, text: async () => JSON.stringify({ status: "submitted", request_id: "req_fmt" }) } as Response;
      }
      return { status: 200, text: async () => JSON.stringify({ status: "completed", request_id: "req_fmt", video: { url: "https://cdn/f.mp4" } }) } as Response;
    });
    process.env.HIGGSFIELD_API_KEY_ID = CREDS.keyId;
    process.env.HIGGSFIELD_API_KEY_SECRET = CREDS.keySecret;
    await generateReelClipVideoViaApi(req, { pollIntervalMs: 1 });
    return body;
  }

  it("sends 9:16 / 4s / 1080p by DEFAULT — a caller cannot forget the shop's format", async () => {
    const body = await submitAndCaptureBody({ prompt: "brake pad wearing thin" });
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.duration).toBe(4);
    expect(body.resolution).toBe("1080p");
  });

  it("those defaults equal the CLI's proven arg values, not a second opinion", () => {
    // Pinned against the arg builder itself, so the two lanes cannot drift into
    // producing different-shaped clips for the same reel.
    const cli = readFileSync(resolve(process.cwd(), "server/services/higgsfieldStudio.ts"), "utf8");
    const args = cli.slice(cli.indexOf("export function buildSeedanceArgs"));
    const block = args.slice(0, args.indexOf("];"));
    expect(block).toContain(`"${REEL_CLIP_DEFAULTS.aspectRatio}"`);
    expect(block).toContain(`"${String(REEL_CLIP_DEFAULTS.durationSeconds)}"`);
    expect(block).toContain(`"${REEL_CLIP_DEFAULTS.resolution}"`);
  });

  it("an explicit request value overrides the default", async () => {
    const body = await submitAndCaptureBody({ prompt: "x", durationSeconds: 6, aspectRatio: "1:1", resolution: "720p" });
    expect(body.duration).toBe(6);
    expect(body.aspect_ratio).toBe("1:1");
    expect(body.resolution).toBe("720p");
  });

  it("enhance_prompt is FALSE — the vendor must not rewrite copy after our claim gate", async () => {
    // This shop cannot make unsupported claims. The prompt has already passed
    // reviewReplyQa / the M10 preflight; a server-side rewrite would put
    // unreviewed copy into a published reel.
    const body = await submitAndCaptureBody({ prompt: "x" });
    expect(body.enhance_prompt).toBe(false);
  });

  it("warns when there is no start image, because portrait then rests on one field", async () => {
    const body = await submitAndCaptureBody({ prompt: "x" });
    expect(body.input_images).toBeUndefined();
    expect(body.aspect_ratio).toBe("9:16");
  });
});
