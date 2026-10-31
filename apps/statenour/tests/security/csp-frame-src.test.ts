/**
 * U3 (2026-10-31) · CSP frame-src: exactly the two video players may be framed.
 * Before: no frame-src, so default-src 'self' blocked any embed. The widening is pinned to two
 * exact hosts, never a wildcard, and frame-ancestors stays 'none'.
 */
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";

const directive = (csp: string, name: string) =>
  csp.split(";").map((p) => p.trim().split(/\s+/)).find((t) => t[0] === name)?.slice(1) ?? null;

describe("CSP frame-src (U3)", () => {
  it.each([false, true])("isDev=%s: frame-src is exactly the YouTube nocookie and Vimeo players", (isDev) => {
    const csp = buildCsp("n0nce", isDev);
    expect(directive(csp, "frame-src")).toEqual(["https://www.youtube-nocookie.com", "https://player.vimeo.com"]);
  });

  it("CONTROL: frame-ancestors stays 'none' (no one may frame bdnick)", () => {
    expect(directive(buildCsp("n0nce", false), "frame-ancestors")).toEqual(["'none'"]);
  });
});
