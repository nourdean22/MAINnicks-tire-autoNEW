/**
 * Outbound-fetch safety: refuse non-public hosts, re-check every redirect hop,
 * and never buffer an unbounded body.
 *
 * EXTRACTED, NOT WRITTEN. Every rule below already existed in
 * services/higgsfieldStudio.ts, hardened over two audit passes. It moved here
 * because a SECOND caller appeared — mp4Ingest's loadSource fetches an
 * operator-supplied URL — and the review that caught it named the exact holes
 * this file already closed for the other caller: blind SSRF against Railway
 * metadata via a redirect, and `arrayBuffer()` on an indefinitely streamed body.
 *
 * A copy would have been the drift generator. The comments below are kept
 * verbatim from the original because each one records a specific bypass that
 * was live at some point.
 */
import { isIP } from "net";

/** Dotted-quad -> uint32. Only called after net.isIP() has confirmed the form. */
function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;
}

/**
 * Refuse every IPv4 block that is not globally routable.
 *
 * Written as explicit CIDRs rather than string prefixes because the old
 * `/^127\./`-style tests were the defect: they matched text, so any alternate
 * encoding of the same address slipped past. These compare numbers.
 */
export function assertPublicIPv4(ip: string): void {
  const n = ipv4ToInt(ip);
  const inBlock = (base: string, bits: number) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  };
  const BLOCKED: Array<[string, number, string]> = [
    ["0.0.0.0", 8, "this-network"], // covers 0.1.2.3, not just the literal 0.0.0.0
    ["10.0.0.0", 8, "private"],
    ["100.64.0.0", 10, "carrier-grade NAT"],
    ["127.0.0.0", 8, "loopback"],
    ["169.254.0.0", 16, "link-local (incl. 169.254.169.254 cloud metadata)"],
    ["172.16.0.0", 12, "private"],
    ["192.0.0.0", 24, "IETF protocol assignments"],
    ["192.0.2.0", 24, "TEST-NET-1"],
    ["192.88.99.0", 24, "6to4 relay anycast"],
    ["192.168.0.0", 16, "private"],
    ["198.18.0.0", 15, "benchmarking"],
    ["198.51.100.0", 24, "TEST-NET-2"],
    ["203.0.113.0", 24, "TEST-NET-3"],
    ["224.0.0.0", 4, "multicast"],
    ["240.0.0.0", 4, "reserved (incl. 255.255.255.255 broadcast)"],
  ];
  for (const [base, bits, label] of BLOCKED) {
    if (inBlock(base, bits)) throw new Error(`refusing non-public host ${ip} (${label})`);
  }
}

/**
 * Pull out an IPv4 address embedded in an IPv6 literal, if any.
 * Covers ::ffff:a.b.c.d and its hex form, ::ffff:0:a.b.c.d (IPv4-translated), and
 * 2002::/16 (6to4). Each of these reaches an IPv4 destination, so the IPv4 rules
 * are what must decide — a fix that special-cases only `::ffff:` is incomplete.
 */
export function embeddedIPv4(ip: string): string | null {
  const hex = ip.toLowerCase();
  const dotted = hex.match(/::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const asHex = hex.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (asHex) {
    const hi = parseInt(asHex[1], 16);
    const lo = parseInt(asHex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  const sixToFour = hex.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    const lo = parseInt(sixToFour[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * Allowlist global unicast (2000::/3) and refuse Teredo (2001::/32), which
 * tunnels to an obfuscated IPv4 endpoint.
 *
 * Allowlisting matters more than the specific exclusions — loopback (::1), the
 * unspecified address (::), unique-local (fc00::/7), link-local (fe80::/10) and
 * NAT64 (64:ff9b::/96) all fall outside 2000::/3 and are refused without needing
 * their own rule. A range nobody thought of fails closed by default.
 */
export function assertPublicIPv6(ip: string): void {
  const first = ip.toLowerCase().split(":")[0];
  const head = first === "" ? 0 : parseInt(first, 16); // "::1" -> leading empty group
  if (head < 0x2000 || head > 0x3fff) {
    throw new Error(`refusing non-public host ${ip} (not global unicast 2000::/3)`);
  }
  if (/^2001:0{0,3}:/.test(ip.toLowerCase())) {
    throw new Error(`refusing non-public host ${ip} (Teredo tunnel 2001::/32)`);
  }
}

/**
 * Refuse a URL that points at the deploy's own network before anything fetches it.
 *
 * NOTE, deliberately not overstated: this validates the LITERAL host. A DNS name
 * that resolves into private space is not caught here — that needs resolution-time
 * checking or network egress rules. Callers re-validate each redirect hop, which
 * closes the redirect-to-private path but not DNS rebinding.
 */
export function assertPublicHttpUrl(u: URL): void {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`refusing scheme ${u.protocol}`);

  // Strip one trailing FQDN-root dot BEFORE the name checks. "localhost." and
  // "metadata.google.internal." resolve perfectly well while failing an equality
  // or endsWith test — a bypass the previous string matching missed.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`refusing non-public host ${host}`);
  }

  // Classify IP literals by PARSING them, not by matching their text. The previous
  // eleven regexes tested the host string, so every IPv4-mapped IPv6 form walked
  // straight through: the URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1
  // before any /^127\./ test can see it.
  const kind = isIP(host);
  if (kind === 4) {
    assertPublicIPv4(host);
  } else if (kind === 6) {
    const embedded = embeddedIPv4(host);
    // A tunnelled/mapped address must be judged on the IPv4 it actually reaches,
    // so ::ffff:8.8.8.8 stays allowed while ::ffff:127.0.0.1 does not.
    if (embedded) assertPublicIPv4(embedded);
    else assertPublicIPv6(host);
  }
}

export interface BoundedFetchOptions {
  /** Hard ceiling on the body. Enforced while streaming, not after. */
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** Prefixes the size/redirect errors so a caller's message names its own subject. */
  label: string;
}

/**
 * Fetch a public URL into a Buffer, refusing non-public hosts on EVERY hop and
 * capping the body while it streams.
 *
 * `redirect: "manual"` is the load-bearing part. A plain fetch follows a 302 to
 * anywhere, so validating only the URL the caller supplied leaves the whole
 * private network one redirect away — which is precisely the shape of a blind
 * SSRF against a cloud metadata endpoint.
 */
export async function fetchPublicBounded(url: string | URL, o: BoundedFetchOptions): Promise<Buffer> {
  let current = new URL(url);
  let res: Response | undefined;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    assertPublicHttpUrl(current);
    res = await fetch(current, { signal: AbortSignal.timeout(o.timeoutMs), redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`${o.label}: redirect ${res.status} without location`);
      current = new URL(loc, current); // resolved, then re-checked at the top of the next hop
      continue;
    }
    break;
  }
  if (!res) throw new Error(`${o.label}: no response`);
  if (res.status >= 300 && res.status < 400) throw new Error(`${o.label}: too many redirects (>${o.maxRedirects})`);
  if (!res.ok) throw new Error(`${o.label}: fetch ${res.status}`);

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > o.maxBytes) {
    throw new Error(`${o.label}: too large (${declared} bytes declared, cap ${o.maxBytes})`);
  }
  // Read incrementally: content-length is a hint, not a guarantee, so the cap
  // has to hold against a body that just keeps coming.
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${o.label}: no response body`);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > o.maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`${o.label}: exceeded ${o.maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
