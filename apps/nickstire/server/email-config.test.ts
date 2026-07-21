import { describe, it, expect } from "vitest";

/**
 * The two env tests used to branch `if (!VAR) { expect(true).toBe(true); return }`.
 * No test setup loads dotenv (vitest.config setupFiles is client-only), so the
 * var is absent in CI and in every worktree — meaning they ALWAYS took the
 * constant branch and reported green having checked nothing, while their names
 * claimed "SHOP_EMAIL configured in production ✓".
 *
 * `it.runIf` makes the honest thing happen: when the var is present the real
 * shape assertion runs; when it is absent the case is SKIPPED (visibly), not
 * passed. A skipped test tells the truth; a vacuous pass does not.
 */
describe("Email Configuration", () => {
  it.runIf(!!process.env.SHOP_EMAIL)("SHOP_EMAIL, when set, looks like an address", () => {
    expect(process.env.SHOP_EMAIL).toContain("@");
  });

  it.runIf(!!process.env.CEO_EMAIL)("CEO_EMAIL, when set, looks like an address", () => {
    expect(process.env.CEO_EMAIL).toContain("@");
  });

  it("email-notify module references both recipients", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/email-notify.ts", "utf8");
    expect(content).toContain("export");
    expect(content).toContain("SHOP_EMAIL");
    expect(content).toContain("CEO_EMAIL");
  });
});
