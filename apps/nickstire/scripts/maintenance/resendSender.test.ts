/**
 * The Resend verifier must check the sender the app REALLY uses.
 *
 * #2593's verifier read EMAIL_FROM, which no runtime code reads, so it could
 * print SENDING for one domain while the app sent from another. These tests pin
 * the verifier's resolution to the runtime's, and fail if either runtime sender
 * drifts away from the expression resend-sender.mjs mirrors.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DEFAULT_FROM, fromDomain, resolveSender } from "./resend-sender.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");

describe("resolveSender mirrors the runtime sender", () => {
  it("uses RESEND_FROM_EMAIL when it is set", () => {
    const s = resolveSender({ RESEND_FROM_EMAIL: "Shop <mail@example.org>" });
    expect(s.from).toBe("Shop <mail@example.org>");
    expect(s.source).toBe("RESEND_FROM_EMAIL");
    expect(s.domain).toBe("example.org");
  });

  it("falls back to the nickstire.org default when RESEND_FROM_EMAIL is unset or empty", () => {
    for (const env of [{}, { RESEND_FROM_EMAIL: "" }]) {
      const s = resolveSender(env);
      expect(s.from).toBe(APP_DEFAULT_FROM);
      expect(s.source).toMatch(/^app default/);
      expect(s.domain).toBe("nickstire.org");
    }
  });

  it("ignores EMAIL_FROM for resolution and only reports it", () => {
    const unset = resolveSender({ EMAIL_FROM: "Nick's Tire & Auto <noreply@autonicks.com>" });
    expect(unset.domain).toBe("nickstire.org");
    expect(unset.ignoredEmailFrom).toBe("Nick's Tire & Auto <noreply@autonicks.com>");

    const both = resolveSender({ EMAIL_FROM: "a@autonicks.com", RESEND_FROM_EMAIL: "b@example.org" });
    expect(both.domain).toBe("example.org");
    expect(both.source).toBe("RESEND_FROM_EMAIL");
  });

  it("reads the domain from both address shapes", () => {
    expect(fromDomain("Nick's Tire & Auto <noreply@NickSTire.org>")).toBe("nickstire.org");
    expect(fromDomain("noreply@nickstire.org")).toBe("nickstire.org");
    expect(fromDomain("no-at-sign")).toBeNull();
  });
});

describe("runtime senders still use the mirrored expression", () => {
  const expression = `process.env.RESEND_FROM_EMAIL || ${JSON.stringify(APP_DEFAULT_FROM)}`;
  for (const file of ["server/email-notify.ts", "server/services/dripProcessor.ts"]) {
    it(`${file} resolves From as RESEND_FROM_EMAIL || the default`, () => {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).toContain(expression);
      expect(src).not.toMatch(/process\.env\.EMAIL_FROM\b/);
    });
  }
});
