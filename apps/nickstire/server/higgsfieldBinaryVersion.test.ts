/**
 * The CLI version the downloader uses must equal the version the repo installs.
 *
 * It did not: the downloader hardcoded "0.2.2" while package.json pinned
 * @higgsfield/cli at "0.2.3", so the GitHub release URL pointed at a build the repo
 * never installs. Nothing catches that at runtime except a 404 on a machine with no
 * cached binary - which is exactly the machine that needs `higgsfield auth login`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HIGGSFIELD_CLI_VERSION } from "./services/higgsfieldBinary";

describe("the Higgsfield CLI version cannot drift from the dependency pin", () => {
  it("HIGGSFIELD_CLI_VERSION equals the @higgsfield/cli pin in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const pinned = pkg.dependencies?.["@higgsfield/cli"] ?? pkg.devDependencies?.["@higgsfield/cli"];
    expect(pinned, "@higgsfield/cli must be a declared dependency").toBeTruthy();
    // The pin is exact (no ^ or ~) precisely so this comparison is meaningful.
    expect(pinned).not.toMatch(/[\^~><*]/);
    expect(HIGGSFIELD_CLI_VERSION).toBe(pinned);
  });

  it("the downloader builds its URL from that constant, not a literal", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/higgsfieldBinary.ts"), "utf8");
    // Anchored on the assignment so explanatory historical comments naming old
    // versions can neither satisfy nor break this.
    expect(src).toContain("const version = HIGGSFIELD_CLI_VERSION;");
    expect(src).not.toMatch(/const version = "\d+\.\d+\.\d+";/);
  });

  it("the temp cache is version-scoped so an old native binary cannot survive a pin bump", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/higgsfieldBinary.ts"), "utf8");
    expect(src).toContain("`higgsfield-cli-${HIGGSFIELD_CLI_VERSION}`");
    expect(src).not.toContain("const tempDir = os.tmpdir();");
  });

  it("documents the workspace id required by current non-interactive CLI calls", () => {
    const env = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("HIGGSFIELD_WORKSPACE_ID=");
  });

  it("credential recovery uses railway-injected DATABASE_URL, not a hard-coded checkout secret file", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/push-higgsfield-creds.mjs"), "utf8");
    expect(src).toContain("process.env.DATABASE_URL");
    expect(src).not.toContain("C:/Users/nourd/NOURCITY/apps/nickstire/.env");
  });
});
