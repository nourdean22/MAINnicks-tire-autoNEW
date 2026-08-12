/**
 * Normal-chat cost firewall tests (lib/ai/provider.ts +
 * config/ai-providers.ts) — operator directive 2026-08-11: $0
 * incremental model spend on normal chat; a provider key is
 * AVAILABILITY, not spending AUTHORIZATION.
 *
 * NOTE: the global test setup pins NICK_COST_FIREWALL=0 so the
 * provider-chain tests keep exercising metered rotation mechanics.
 * These tests set the env explicitly per case and restore it.
 */

import { afterEach, describe, it, expect } from "vitest";
import { isCostFirewallOn, filterByCostFirewall, type ProviderName } from "@/lib/ai/provider";
import { PROVIDER_COST_CLASS } from "@/config/ai-providers";

const CHAIN: Array<{ name: ProviderName }> = [
  { name: "ollama" },
  { name: "openrouter" },
  { name: "gemini" },
  { name: "openai" },
  { name: "anthropic" },
];

afterEach(() => {
  process.env.NICK_COST_FIREWALL = "0"; // restore the suite default
});

describe("PROVIDER_COST_CLASS", () => {
  it("classifies exactly one zero-incremental lane (the Ollama flat subscription)", () => {
    const zero = Object.entries(PROVIDER_COST_CLASS).filter(([, c]) => c === "zero_incremental");
    expect(zero).toEqual([["ollama", "zero_incremental"]]);
  });
});

describe("isCostFirewallOn", () => {
  it("is ON by default (unset env) and only the explicit kill-switch disables it", () => {
    delete process.env.NICK_COST_FIREWALL;
    expect(isCostFirewallOn()).toBe(true);
    process.env.NICK_COST_FIREWALL = "0";
    expect(isCostFirewallOn()).toBe(false);
    process.env.NICK_COST_FIREWALL = "1";
    expect(isCostFirewallOn()).toBe(true);
  });
});

describe("filterByCostFirewall", () => {
  it("restricts a normal lane to zero-incremental providers", () => {
    process.env.NICK_COST_FIREWALL = "1";
    const out = filterByCostFirewall(CHAIN, false);
    expect(out.map((p) => p.name)).toEqual(["ollama"]);
  });

  it("explicit consent (Turbo) opens the metered lanes", () => {
    process.env.NICK_COST_FIREWALL = "1";
    const out = filterByCostFirewall(CHAIN, true);
    expect(out).toHaveLength(CHAIN.length);
  });

  it("the kill-switch restores the full chain without consent", () => {
    process.env.NICK_COST_FIREWALL = "0";
    const out = filterByCostFirewall(CHAIN, false);
    expect(out).toHaveLength(CHAIN.length);
  });

  it("never mutates the input array", () => {
    process.env.NICK_COST_FIREWALL = "1";
    const input = [...CHAIN];
    filterByCostFirewall(input, false);
    expect(input).toHaveLength(CHAIN.length);
  });
});
