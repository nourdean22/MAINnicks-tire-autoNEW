/**
 * lib/publicFetch — the outbound-fetch guard, now shared by two callers.
 *
 * WHY THIS FILE EXISTS NOW. These rules lived inside higgsfieldStudio.ts,
 * private, tested only through materializeStartImage. Wiring mp4Ingest to an
 * admin mutation made a SECOND caller fetch an operator-supplied URL, and the
 * review on that PR named exactly the two holes the original had already
 * closed for the other caller: blind SSRF via a redirect to cloud metadata,
 * and `arrayBuffer()` on a body that never ends.
 *
 * Copying the guard would have been the drift generator — two hardened
 * implementations diverging one bypass at a time. It was extracted instead, and
 * these assert the extraction kept every rule, including the ones written for
 * bypasses that were once live: alternate encodings of a loopback address, the
 * FQDN-root dot, and IPv4 smuggled inside an IPv6 literal.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertPublicHttpUrl, assertPublicIPv4, embeddedIPv4, fetchPublicBounded } from "./lib/publicFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

const refuses = (u: string) => expect(() => assertPublicHttpUrl(new URL(u))).toThrow();
const allows = (u: string) => expect(() => assertPublicHttpUrl(new URL(u))).not.toThrow();

describe("the metadata endpoint and the private network", () => {
  it("refuses the cloud metadata address every provider uses", () => {
    refuses("http://169.254.169.254/latest/meta-data/");
  });

  it("refuses loopback and every RFC1918 range", () => {
    refuses("http://127.0.0.1/");
    refuses("http://10.1.2.3/");
    refuses("http://172.16.0.1/");
    refuses("http://192.168.1.1/");
  });

  it("refuses ranges a prefix test would miss", () => {
    refuses("http://0.1.2.3/");        // 0.0.0.0/8, not just the literal
    refuses("http://100.100.1.1/");    // carrier-grade NAT
    refuses("http://198.18.0.1/");     // benchmarking
    refuses("http://255.255.255.255/");// reserved/broadcast
  });

  it("still allows an ordinary public address", () => {
    allows("https://8.8.8.8/");
    allows("https://cdn.example.com/final.mp4");
  });
});

describe("the bypasses these rules were written for", () => {
  it("refuses a loopback address smuggled inside an IPv6 literal", () => {
    // The URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1 before any
    // /^127\./ text test can see it — which is why the guard parses instead.
    refuses("http://[::ffff:127.0.0.1]/");
    refuses("http://[::ffff:7f00:1]/");
    refuses("http://[::1]/");
  });

  it("judges a 6to4 or mapped address on the IPv4 it actually reaches", () => {
    expect(embeddedIPv4("::ffff:7f00:1")).toBe("127.0.0.1");
    expect(embeddedIPv4("2002:a00:1::")).toBe("10.0.0.1");
    expect(() => assertPublicIPv4(embeddedIPv4("::ffff:7f00:1")!)).toThrow();
    // and a mapped PUBLIC address stays allowed — the rule is not "refuse mapped"
    allows("http://[::ffff:8.8.8.8]/");
  });

  it("refuses a name with the FQDN root dot, which resolves fine and fails an equality test", () => {
    refuses("http://localhost./");
    refuses("http://metadata.google.internal./");
    refuses("http://localhost/");
    refuses("http://foo.internal/");
  });

  it("refuses a non-http scheme outright", () => {
    refuses("file:///etc/passwd");
    refuses("gopher://example.com/");
  });
});

/**
 * The two properties that actually stop the attack live in the FETCH LOOP, not
 * in the pure host checks — and a first pass at this file asserted only the
 * pure ones. Both mutations below (validate the first hop only · drop the
 * streaming cap) left every other test in this file green, which is the whole
 * argument for exercising the loop rather than reading it.
 */
function body(chunks: Uint8Array[]) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
      cancel: async () => {},
    }),
  };
}
const res = (init: { status?: number; headers?: Record<string, string>; chunks?: Uint8Array[] }) => ({
  status: init.status ?? 200,
  ok: (init.status ?? 200) < 400,
  headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
  body: body(init.chunks ?? [new Uint8Array([1, 2, 3])]),
});

const OPTS = { maxBytes: 100, timeoutMs: 1000, maxRedirects: 3, label: "test" };

describe("the redirect loop re-validates EVERY hop", () => {
  it("refuses a public URL that redirects to the metadata endpoint", async () => {
    // The attack in one line: the submitted URL is fine, the destination is not.
    // A plain `fetch` follows this without ever showing the caller hop two.
    vi.stubGlobal("fetch", vi.fn(async (u: URL) =>
      String(u).includes("169.254")
        ? res({})
        : res({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    ));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).rejects.toThrow(/refusing non-public host/);
  });

  it("refuses a redirect chain that reaches loopback on the SECOND hop", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      seen.push(String(u));
      if (seen.length === 1) return res({ status: 302, headers: { location: "https://other.example.com/b" } });
      if (seen.length === 2) return res({ status: 302, headers: { location: "http://127.0.0.1/admin" } });
      return res({});
    }));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).rejects.toThrow(/refusing non-public host/);
    // Three fetches would mean the loopback hop was actually requested.
    expect(seen).toHaveLength(2);
  });

  it("asks fetch NOT to follow redirects itself", async () => {
    // Asserted directly because a stubbed fetch cannot demonstrate it: the stub
    // ignores the option, so flipping it to "follow" leaves every behavioural
    // case above green while handing redirect-following back to the runtime —
    // and the runtime does not re-validate hosts. The mechanism has to be
    // pinned, not merely exercised.
    const spy = vi.fn(async () => res({}));
    vi.stubGlobal("fetch", spy);
    await fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS);
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("still follows an ordinary redirect between public hosts", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () =>
      n++ === 0 ? res({ status: 302, headers: { location: "https://cdn2.example.com/a.mp4" } }) : res({}),
    ));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).resolves.toHaveLength(3);
  });

  it("gives up rather than following redirects forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ status: 302, headers: { location: "https://cdn.example.com/loop" } })));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).rejects.toThrow(/too many redirects/);
  });
});

describe("the size cap holds while the body streams", () => {
  it("refuses a body that exceeds the cap even though content-length lied", async () => {
    // content-length is a hint, not a guarantee. A server that under-declares
    // and then keeps sending is the case a post-hoc length check cannot catch.
    vi.stubGlobal("fetch", vi.fn(async () =>
      res({ headers: { "content-length": "10" }, chunks: [new Uint8Array(60), new Uint8Array(60)] }),
    ));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).rejects.toThrow(/exceeded 100 bytes/);
  });

  it("refuses up front when the declared length already exceeds the cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ headers: { "content-length": "999999" } })));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).rejects.toThrow(/too large/);
  });

  it("accepts a body under the cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ chunks: [new Uint8Array(40), new Uint8Array(40)] })));
    await expect(fetchPublicBounded("https://cdn.example.com/a.mp4", OPTS)).resolves.toHaveLength(80);
  });
});

describe("what this guard does NOT claim", () => {
  it("allows a public NAME that could resolve into private space — DNS rebinding is out of scope", () => {
    // Stated as a test rather than only a comment so nobody reads the guard as
    // complete. Closing this needs resolution-time checking or egress rules.
    allows("http://rebind.example.com/");
  });
});
