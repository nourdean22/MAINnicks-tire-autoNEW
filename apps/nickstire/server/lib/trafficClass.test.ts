/**
 * trafficClass — positive controls from the 2026-10-01 production bot fleet.
 * IPs and UAs below are the real shapes seen in Railway HTTP logs that day
 * (Azure datacenter addresses with spoofed mobile/desktop UAs), plus a
 * non-datacenter address (RFC 5737 TEST-NET-2, standing in for the mobile-carrier visitors seen that day) that must NOT be called a datacenter.
 */
import { describe, expect, it } from "vitest";
import {
  buildRangeSet,
  classifyUserAgent,
  decideTrafficClass,
  inRangeSet,
  parseProviderCidrs,
} from "./trafficClass";

const SPOOFED_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";
const REAL_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

// Azure prefixes covering the fleet IPs (shape of Service Tags entries), plus an AWS and a v6 entry.
const RANGES = buildRangeSet([
  "4.152.0.0/14",      // 4.155.134.61
  "20.96.0.0/12",      // 20.106.183.55
  "128.203.128.0/17",  // 128.203.189.244 — above 128.0.0.0: the signed-int trap
  "172.208.0.0/13",    // 172.212.171.146
  "3.5.140.0/22",
  "2603:1000::/24",
]);

describe("classifyUserAgent", () => {
  it("flags the impossible iOS 16 + Safari 26 pair from the fleet", () => {
    expect(classifyUserAgent(SPOOFED_IPHONE)).toBe("ua_inconsistent");
  });
  it("does not flag a real iOS 18 / Safari 26 phone", () => {
    expect(classifyUserAgent(REAL_IPHONE)).toBeNull();
  });
  it("flags headless and our own audit runs", () => {
    expect(classifyUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0 Safari/537.36")).toBe("automation");
    expect(classifyUserAgent("Mozilla/5.0 (axe-audit; Claude Code session) Chrome/140")).toBe("automation");
    expect(classifyUserAgent("Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)")).toBe("automation");
  });
  it("a plain Android UA proves nothing on its own", () => {
    expect(classifyUserAgent(ANDROID)).toBeNull();
  });
});

describe("inRangeSet", () => {
  it("matches every fleet IP, including those above 128.0.0.0", () => {
    for (const ip of ["4.155.134.61", "20.106.183.55", "128.203.189.244", "172.212.171.146"]) {
      expect(inRangeSet(RANGES, ip), ip).toBe(true);
    }
  });
  it("does not match a residential-style address (TEST-NET-2, RFC 5737) or the edges just outside a range", () => {
    expect(inRangeSet(RANGES, "198.51.100.7")).toBe(false);
    expect(inRangeSet(RANGES, "128.203.127.255")).toBe(false);
    expect(inRangeSet(RANGES, "128.203.255.255")).toBe(true);
    expect(inRangeSet(RANGES, "128.204.0.0")).toBe(false);
  });
  it("checks IPv6 and IPv4-mapped IPv6", () => {
    expect(inRangeSet(RANGES, "2603:1000::1")).toBe(true);
    expect(inRangeSet(RANGES, "2001:db8::1")).toBe(false);
    expect(inRangeSet(RANGES, "::ffff:20.106.183.55")).toBe(true);
  });
  it("merges overlapping prefixes", () => {
    const s = buildRangeSet(["10.0.0.0/8", "10.1.0.0/16", "11.0.0.0/8"]);
    expect(s.v4).toEqual([[167772160, 201326591]]);
  });
});

describe("decideTrafficClass", () => {
  it("Android UA from an Azure IP is datacenter (the case UA rules miss)", () => {
    expect(decideTrafficClass({ userAgent: ANDROID, ip: "64.236.135.136", ranges: buildRangeSet(["64.236.0.0/16"]), rangesComplete: true })).toBe("datacenter");
  });
  it("real phone on a carrier IP is human only when the ranges are complete", () => {
    expect(decideTrafficClass({ userAgent: REAL_IPHONE, ip: "198.51.100.7", ranges: RANGES, rangesComplete: true })).toBe("human");
    expect(decideTrafficClass({ userAgent: REAL_IPHONE, ip: "198.51.100.7", ranges: RANGES, rangesComplete: false })).toBe("unknown");
  });
  it("no ranges loaded yet -> unknown, never human", () => {
    expect(decideTrafficClass({ userAgent: REAL_IPHONE, ip: "198.51.100.7", ranges: null, rangesComplete: false })).toBe("unknown");
  });
  it("the UA verdict wins regardless of IP", () => {
    expect(decideTrafficClass({ userAgent: SPOOFED_IPHONE, ip: "198.51.100.7", ranges: null, rangesComplete: false })).toBe("ua_inconsistent");
  });
});

describe("parseProviderCidrs", () => {
  it("reads each provider's published shape", () => {
    expect(parseProviderCidrs("aws", { prefixes: [{ ip_prefix: "3.5.140.0/22" }], ipv6_prefixes: [{ ipv6_prefix: "2600:1f00::/24" }] })).toEqual(["3.5.140.0/22", "2600:1f00::/24"]);
    expect(parseProviderCidrs("gcp", { prefixes: [{ ipv4Prefix: "34.1.208.0/20" }, { ipv6Prefix: "2600:1900::/35" }] })).toEqual(["34.1.208.0/20", "2600:1900::/35"]);
    expect(parseProviderCidrs("azure", { values: [{ properties: { addressPrefixes: ["4.152.0.0/14", "2603:1000::/24"] } }] })).toEqual(["4.152.0.0/14", "2603:1000::/24"]);
    expect(parseProviderCidrs("oracle", { regions: [{ cidrs: [{ cidr: "129.146.0.0/21" }] }] })).toEqual(["129.146.0.0/21"]);
  });
  it("an unexpected body yields no CIDRs rather than throwing", () => {
    expect(parseProviderCidrs("azure", {})).toEqual([]);
  });
});
