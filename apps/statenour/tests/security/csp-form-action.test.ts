/**
 * CSP form-action pin (2026-10-25).
 *
 * The sign-in button is a same-origin form POST to /auth/sign-in/google, and
 * that route answers 303 to https://accounts.google.com/o/oauth2/v2/auth
 * (app/auth/sign-in/google/route.ts:40). Chromium enforces form-action on the
 * redirect target of a form submission, so `form-action 'self'` blocked a fresh
 * Chrome sign-in: "Sending form data to 'https://bdnick.info/auth/sign-in/google'
 * violates the following Content Security Policy directive: form-action 'self'".
 *
 * These tests assert the header the browser enforces, not the source text.
 */
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";

const GOOGLE_OAUTH_HOST = "https://accounts.google.com";

/** Parse a CSP header value into directive name -> source list. */
function parseCsp(header: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out.set(tokens[0], tokens.slice(1));
  }
  return out;
}

/**
 * Sources that are a wildcard (`*`, `https://*.x`) or plain-http. Run over every
 * directive except connect-src, which already carries `https://*.openai.com`,
 * `http://localhost:11434` and `wss:` for the AI fallback chain and VAPI (a
 * pre-existing, documented policy this change does not touch).
 */
function looseSources(header: string): string[] {
  const loose: string[] = [];
  for (const [name, sources] of parseCsp(header)) {
    if (name === "connect-src") continue;
    for (const source of sources) {
      if (source.includes("*") || source.toLowerCase().startsWith("http:")) {
        loose.push(`${name} ${source}`);
      }
    }
  }
  return loose;
}

const BUILDS = [
  ["production", false],
  ["development", true],
] as const;

describe.each(BUILDS)("CSP form-action (%s build)", (_label, isDev) => {
  const header = buildCsp("test-nonce", isDev);
  const directives = parseCsp(header);

  it("lets the sign-in form redirect to the Google OAuth host as well as self", () => {
    const sources = directives.get("form-action");
    expect(sources, "form-action directive present").toBeDefined();
    expect(sources).toContain("'self'");
    expect(sources).toContain(GOOGLE_OAUTH_HOST);
  });

  it("names nothing else: a form posting anywhere other than self or Google stays blocked", () => {
    expect(directives.get("form-action")).toEqual(["'self'", GOOGLE_OAUTH_HOST]);
  });

  it("keeps the neighbouring locks (frame-ancestors, base-uri, object-src, default-src)", () => {
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("default-src")).toEqual(["'self'"]);
  });

  it("carries no wildcard or http: source outside connect-src", () => {
    expect(looseSources(header)).toEqual([]);
  });
});

describe("CSP form-action test instruments", () => {
  it("the parser located the directive set (11 directives since U3 frame-src, form-action among them)", () => {
    const directives = parseCsp(buildCsp("test-nonce", false));
    expect(directives.size).toBe(11);
    expect(directives.has("form-action")).toBe(true);
    expect(directives.has("connect-src")).toBe(true);
  });

  it("the loose-source scanner flags planted wildcard and http: sources", () => {
    expect(looseSources("default-src 'self'; form-action 'self' *")).toEqual(["form-action *"]);
    expect(looseSources("form-action 'self' https://*.google.com")).toEqual(["form-action https://*.google.com"]);
    expect(looseSources("form-action 'self' http://accounts.google.com")).toEqual([
      "form-action http://accounts.google.com",
    ]);
    expect(looseSources("form-action 'self' https://accounts.google.com")).toEqual([]);
  });

  it("the scanner skips connect-src only (the documented pre-existing exception)", () => {
    expect(looseSources("connect-src 'self' https://*.openai.com http://localhost:11434 wss:")).toEqual([]);
    expect(looseSources("img-src 'self' http://x.test")).toEqual(["img-src http://x.test"]);
  });
});
