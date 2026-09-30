/**
 * tests/security/url-safety-rebinding-and-ranges.test.ts
 * Q-14 · estate architecture 2026-09-23 §10.1 S5 (exfiltration through reads)
 *
 * Three holes in lib/utils/url-safety.ts, each tested red on the pre-fix code:
 *
 * 1. Ranges. `isPrivateIPv6` passed `::` (a name whose AAAA is `::` dials this
 *    host), NAT64 `64:ff9b::/96` (reaches the embedded IPv4 on a NAT64 network)
 *    and multicast; IPv4 multicast/reserved passed too.
 * 2. IPv6 literals. `URL.hostname` keeps the brackets, so a literal skipped the
 *    literal check and failed a DNS lookup of "[::1]" instead: closed for the
 *    wrong reason, and every public IPv6 literal was refused.
 * 3. DNS rebinding. `assertPublicUrl()` resolved the name, then `fetch`
 *    resolved it again to connect. A name that answers public first and
 *    127.0.0.1 second walked through. The fix checks the address at connect
 *    time (an undici dispatcher with a public-only lookup).
 *
 * Every refusal has a positive control beside it: a public answer still
 * passes, and the rebinding server is proven reachable without the guard, so
 * "zero requests reached it" means the guard stopped them.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";

// name -> answers. `checkAnswers` is what assertPublicUrl's up-front lookup
// sees (node:dns/promises); `connectAnswers` is what the connect-time lookup
// sees (node:dns). Two maps so a test can make them disagree, which is what a
// rebinding name does.
const dnsState = vi.hoisted(() => ({
  checkAnswers: new Map<string, Array<{ address: string; family: number }>>(),
  connectAnswers: new Map<string, Array<{ address: string; family: number }>>(),
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns/promises")>();
  const lookup = async (host: string, opts?: unknown) => {
    const answers = dnsState.checkAnswers.get(host);
    if (!answers) return (real.lookup as (h: string, o?: unknown) => Promise<unknown>)(host, opts);
    return answers;
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  const lookup = (host: string, opts: unknown, cb: (...args: unknown[]) => void) => {
    const answers = dnsState.connectAnswers.get(host);
    if (!answers) return (real.lookup as (...a: unknown[]) => void)(host, opts, cb);
    queueMicrotask(() => cb(null, answers));
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

import {
  assertPublicUrl,
  connectBlockedReason,
  createPublicOnlyLookup,
  fetchPublicUrl,
} from "@/lib/utils/url-safety";

beforeEach(() => {
  dnsState.checkAnswers.clear();
  dnsState.connectAnswers.clear();
});

describe("Q-14 · ranges a resolved name may not land in", () => {
  const blocked: Array<[string, string, number]> = [
    ["unspecified-v6.test", "::", 6],
    ["nat64-loopback.test", "64:ff9b::7f00:1", 6],
    ["nat64-metadata.test", "64:ff9b::a9fe:a9fe", 6],
    ["nat64-local-use.test", "64:ff9b:1::a00:1", 6],
    ["multicast-v6.test", "ff02::1", 6],
    ["multicast-v4.test", "224.0.0.251", 4],
    ["broadcast-v4.test", "255.255.255.255", 4],
  ];

  it.each(blocked)("refuses %s -> %s", async (host, address, family) => {
    dnsState.checkAnswers.set(host, [{ address, family }]);
    const result = await assertPublicUrl(`https://${host}/`);
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/^resolves_to_private_ipv[46]: /);
  });

  it("positive control · public v4 and v6 answers still pass", async () => {
    dnsState.checkAnswers.set("public-v4.test", [{ address: "93.184.216.34", family: 4 }]);
    dnsState.checkAnswers.set("public-v6.test", [{ address: "2606:4700:4700::1111", family: 6 }]);
    expect((await assertPublicUrl("https://public-v4.test/")).safe).toBe(true);
    expect((await assertPublicUrl("https://public-v6.test/")).safe).toBe(true);
  });
});

describe("Q-14 · IPv6 literals are judged as literals", () => {
  it.each(["http://[::]/", "http://[::1]/", "http://[64:ff9b::127.0.0.1]/", "http://[ff02::1]/"])(
    "refuses %s as a private literal, without a DNS lookup",
    async (url) => {
      const result = await assertPublicUrl(url);
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("private_ipv6_literal");
    },
  );

  it("positive control · a public IPv6 literal passes", async () => {
    const result = await assertPublicUrl("https://[2606:4700:4700::1111]/dns-query");
    expect(result).toMatchObject({ safe: true, resolvedIp: "2606:4700:4700::1111" });
  });
});

describe("Q-14 · the address dialled is the address checked (DNS rebinding)", () => {
  let server: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.end("internal-secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    hits = 0;
  });

  it("positive control · without the guard, the rebinding name reaches the internal server", async () => {
    // Same mocked connect-time answer, a dispatcher with no public-only check.
    // This proves the refusal below is the guard, not an unreachable server.
    dnsState.connectAnswers.set("rebind.test", [{ address: "127.0.0.1", family: 4 }]);
    const lookup = (host: string, opts: unknown, cb: (...args: unknown[]) => void) => {
      const answers = dnsState.connectAnswers.get(host)!;
      const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
      if (all) cb(null, answers);
      else cb(null, answers[0].address, answers[0].family);
    };
    const agent = new Agent({ connect: { lookup: lookup as never } });
    const res = await undiciFetch(`http://rebind.test:${port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("internal-secret");
    expect(hits).toBe(1);
    await agent.close();
  });

  it("refuses a name that resolves public at check time and 127.0.0.1 at connect time", async () => {
    dnsState.checkAnswers.set("rebind.test", [{ address: "93.184.216.34", family: 4 }]);
    dnsState.connectAnswers.set("rebind.test", [{ address: "127.0.0.1", family: 4 }]);

    const result = await fetchPublicUrl(`http://rebind.test:${port}/latest/meta-data/`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("url_blocked");
      expect(result.reason).toBe("resolves_to_private_ipv4: 127.0.0.1");
    }
    expect(hits).toBe(0);
  });

  it("refuses when ANY connect-time answer is private, not only the first", async () => {
    dnsState.checkAnswers.set("mixed.test", [{ address: "93.184.216.34", family: 4 }]);
    dnsState.connectAnswers.set("mixed.test", [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const result = await fetchPublicUrl(`http://mixed.test:${port}/`);
    expect(result).toMatchObject({ ok: false, code: "url_blocked" });
    expect(hits).toBe(0);
  });
});

describe("Q-14 · createPublicOnlyLookup contract", () => {
  const call = (resolved: Array<{ address: string; family: number }>, opts: unknown) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
      createPublicOnlyLookup(async () => resolved)("h.test", opts as never, (err, address, family) =>
        resolve({ err, address, family }),
      );
    });

  it("returns every address when asked for all, the first otherwise", async () => {
    const answers = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    expect((await call(answers, { all: true })).address).toEqual(answers);
    expect(await call(answers, {})).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
  });

  it("fails with a code connectBlockedReason recognizes, even wrapped the way fetch wraps it", async () => {
    const { err } = await call([{ address: "169.254.169.254", family: 4 }], { all: true });
    expect(err?.code).toBe("EADDRNOTPUBLIC");
    const wrapped = new TypeError("fetch failed", { cause: err });
    expect(connectBlockedReason(wrapped)).toBe("resolves_to_private_ipv4: 169.254.169.254");
    expect(connectBlockedReason(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }))).toBeNull();
  });

  it("an empty answer is an error, never an empty success", async () => {
    const { err } = await call([], { all: true });
    expect(err?.code).toBe("ENOTFOUND");
  });
});
