/**
 * @prisma/adapter-neon, @prisma/client and prisma move together (2026-10-19).
 *
 * statenour ran client and prisma 6.19.3 with adapter-neon 7.8.0: `"^7.6.0"` in package.json resolved to the
 * newest 7.x while the workspace catalog (`^6.3.1`) held the other two on 6. It worked, but only by luck of
 * the adapter's surface; one Renovate bump of the client to 7 or of the adapter's driver-adapter-utils would
 * have broken the runtime path in lib/prisma.ts with no test going red. Prisma 7 is a separate project.
 *
 * This reads what the build uses (package.json, the pnpm catalog, the lockfile's apps/statenour importer and
 * its package keys), not what is installed, so it holds in CI and in the Docker image alike. The CONTROL
 * tests plant a drift in an in-memory copy of those inputs and prove the gate reports it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

const IMPORTER = "apps/statenour";
const ADAPTER = "@prisma/adapter-neon";
// Prisma 7 is a separate project: change this on purpose in that PR, so a coordinated 7.x bump cannot slip in as "aligned".
const SUPPORTED_MAJOR = "6";

interface Inputs {
  packageJson: string;
  workspace: string;
  lock: string;
}

function realInputs(): Inputs {
  return { packageJson: read("apps/statenour/package.json"), workspace: read("pnpm-workspace.yaml"), lock: read("pnpm-lock.yaml") };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `{specifier, version}` of one dependency in the lockfile's importer block; version loses its peer suffix. */
function importerDep(lock: string, name: string): { specifier: string; version: string } | null {
  const block = lock.match(new RegExp(`^ {2}${esc(IMPORTER)}:\\n((?: {4,}[^\\n]*\\n)+)`, "m"))?.[1];
  if (!block) return null;
  const m = block.match(new RegExp(`^ {6}'?${esc(name)}'?:\\n {8}specifier: ([^\\n]+)\\n {8}version: ([^\\n]+)`, "m"));
  return m ? { specifier: m[1]!.replace(/^'|'$/g, ""), version: m[2]!.replace(/\(.*$/, "") } : null;
}

/** The spec the pnpm catalog gives a package (`catalog:` in package.json points here). */
function catalogSpec(workspace: string, name: string): string | null {
  const m = workspace.match(new RegExp(`^ {2}"?${esc(name)}"?: *"?([^"\\s]+)"?\\s*$`, "m"));
  return m ? m[1]! : null;
}

/** Every adapter-neon version the lockfile carries as a package key, whichever importer asked for it. */
function adapterKeyVersions(lock: string): string[] {
  return [...new Set([...lock.matchAll(new RegExp(`^ {2}'${esc(ADAPTER)}@([^']+)':`, "gm"))].map((m) => m[1]!.replace(/\(.*$/, "")))];
}

const majorMinor = (v: string | null | undefined): string | null => v?.match(/^[~^]?(\d+)\.(\d+)\.\d+/)?.slice(1, 3).join(".") ?? null;
const major = (v: string | null | undefined): string | null => v?.match(/(\d+)\./)?.[1] ?? null;

/** What is wrong with the Prisma set in these inputs; [] means one major.minor throughout. */
function problems(i: Inputs): string[] {
  const out: string[] = [];
  const declared = (JSON.parse(i.packageJson).dependencies ?? {})[ADAPTER] as string | undefined;
  const adapter = importerDep(i.lock, ADAPTER);
  const client = importerDep(i.lock, "@prisma/client");
  const prisma = importerDep(i.lock, "prisma");
  if (!declared || !adapter || !client || !prisma) {
    return [`cannot read the set: package.json=${declared ?? "none"} importer adapter=${adapter?.version ?? "none"} client=${client?.version ?? "none"} prisma=${prisma?.version ?? "none"}`];
  }

  if (!/^[~^]?\d+\.\d+\.\d+$/.test(declared)) out.push(`package.json declares ${ADAPTER} "${declared}", not one plain version a major cannot slip through`);
  if (adapter.specifier !== declared) out.push(`lockfile specifier "${adapter.specifier}" differs from package.json "${declared}": the lockfile is stale`);

  const resolved = { adapter: majorMinor(adapter.version), client: majorMinor(client.version), prisma: majorMinor(prisma.version) };
  if (new Set(Object.values(resolved)).size !== 1) {
    out.push(`resolved adapter-neon ${adapter.version}, client ${client.version}, prisma ${prisma.version} are not one major.minor`);
  }
  if (major(client.version) !== SUPPORTED_MAJOR) {
    out.push(`resolved client ${client.version} is not Prisma ${SUPPORTED_MAJOR}: this gate supports Prisma ${SUPPORTED_MAJOR} only, and Prisma 7 is a separate project`);
  }
  if (majorMinor(declared) !== resolved.client) out.push(`package.json declares ${ADAPTER} ${declared}, but the client resolves ${client.version}`);

  for (const name of ["@prisma/client", "prisma"]) {
    const spec = catalogSpec(i.workspace, name);
    if (major(spec) !== major(adapter.version)) out.push(`catalog ${name} "${spec}" is a different major than adapter-neon ${adapter.version}`);
  }
  for (const v of adapterKeyVersions(i.lock)) {
    if (majorMinor(v) !== resolved.client) out.push(`the lockfile also carries ${ADAPTER}@${v}, not the client's ${client.version}`);
  }
  return out;
}

/** Rewrite the adapter in an in-memory copy: package.json spec, lockfile specifier and version, package keys. */
function withAdapter(i: Inputs, spec: string, version = spec.replace(/^[~^]/, "")): Inputs {
  const pkg = JSON.parse(i.packageJson);
  pkg.dependencies[ADAPTER] = spec;
  const lock = i.lock
    .replace(new RegExp(`(^ {6}'${esc(ADAPTER)}':\\n {8}specifier: )[^\\n]+(\\n {8}version: )[^\\n]+`, "m"), `$1${spec}$2${version}`)
    .replace(new RegExp(`^( {2}'${esc(ADAPTER)}@)[^']+(':)`, "gm"), `$1${version}$2`);
  return { ...i, packageJson: JSON.stringify(pkg, null, 2), lock };
}

function withClient(i: Inputs, version: string): Inputs {
  return { ...i, lock: i.lock.replace(/(^ {6}'@prisma\/client':\n {8}specifier: [^\n]+\n {8}version: )[^(\n]+/m, `$1${version}`) };
}

function withPrisma(i: Inputs, version: string): Inputs {
  return { ...i, lock: i.lock.replace(/(^ {6}prisma:\n {8}specifier: [^\n]+\n {8}version: )[^(\n]+/m, `$1${version}`) };
}

/** Seat the whole set at one known version, so a control never depends on the minor the repo holds today. */
function reseat(i: Inputs, version: string): Inputs {
  return withPrisma(withAdapter(withClient(i, version), version), version);
}

function withCatalog(i: Inputs, name: string, spec: string): Inputs {
  return { ...i, workspace: i.workspace.replace(new RegExp(`^( {2}"?${esc(name)}"?: *)"[^"]+"`, "m"), `$1"${spec}"`) };
}

describe("@prisma/adapter-neon, @prisma/client and prisma share one major.minor", () => {
  const real = realInputs();

  it("the instrument reads the set: all three resolve in the apps/statenour importer", () => {
    for (const name of [ADAPTER, "@prisma/client", "prisma"]) {
      expect(importerDep(real.lock, name)?.version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(catalogSpec(real.workspace, "@prisma/client")).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(catalogSpec(real.workspace, "prisma")).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(adapterKeyVersions(real.lock).length).toBeGreaterThan(0);
  });

  it("the repo's declared and resolved set is aligned", () => {
    expect(problems(real)).toEqual([]);
  });

  describe("CONTROL: planted drift in an in-memory copy of the real inputs is reported", () => {
    // Re-seat the real inputs on a known-good set first, so each mutant is judged from green whatever the
    // repo holds today. A mutation that changes nothing would fail this, instead of passing as "not red".
    const base = reseat(real, "6.19.3");

    it("the planted good set is green", () => {
      expect(importerDep(base.lock, ADAPTER)).toEqual({ specifier: "6.19.3", version: "6.19.3" });
      expect(importerDep(base.lock, "@prisma/client")?.version).toBe("6.19.3");
      expect(problems(base)).toEqual([]);
    });

    it("a caret that floats within 6.19.x stays green", () => {
      expect(problems(withAdapter(base, "^6.19.3", "6.19.3"))).toEqual([]);
    });

    it("the old state (^7.6.0 resolved to 7.8.0 beside a 6.19.3 client) is red", () => {
      const p = problems(withAdapter(base, "^7.6.0", "7.8.0"));
      expect(p.join("\n")).toMatch(/resolved adapter-neon 7\.8\.0, client 6\.19\.3, prisma 6\.19\.3 are not one major\.minor/);
      expect(p.join("\n")).toMatch(/package\.json declares @prisma\/adapter-neon \^7\.6\.0, but the client resolves 6\.19\.3/);
    });

    it("an exact 7.8.0 adapter is red", () => {
      expect(problems(withAdapter(base, "7.8.0")).length).toBeGreaterThan(0);
    });

    it("a range that can cross majors is red", () => {
      for (const spec of [">=6.19.3", "*", "6.x", "^6.19.3 || ^7.0.0", "latest"]) {
        expect(problems(withAdapter(base, spec, "6.19.3")).join("\n"), spec).toMatch(/not one plain version/);
      }
    });

    it("the client moved to 7 with the adapter left on 6 is red", () => {
      expect(problems(withClient(base, "7.8.0")).join("\n")).toMatch(/client 7\.8\.0/);
    });

    it("the catalog bumped to ^7 for the client or for prisma is red", () => {
      expect(problems(withCatalog(base, "@prisma/client", "^7.0.0")).join("\n")).toMatch(/catalog @prisma\/client "\^7\.0\.0"/);
      expect(problems(withCatalog(base, "prisma", "^7.0.0")).join("\n")).toMatch(/catalog prisma "\^7\.0\.0"/);
    });

    it("a lockfile specifier that lags package.json is red", () => {
      const pkg = JSON.parse(base.packageJson);
      pkg.dependencies[ADAPTER] = "6.19.4";
      expect(problems({ ...base, packageJson: JSON.stringify(pkg) }).join("\n")).toMatch(/lockfile is stale/);
    });

    it("a second adapter-neon version left in the lockfile is red", () => {
      const extra = `${base.lock}\n  '${ADAPTER}@7.8.0':\n    resolution: {integrity: sha512-x}\n`;
      expect(problems({ ...base, lock: extra }).join("\n")).toMatch(/also carries @prisma\/adapter-neon@7\.8\.0/);
    });

    it("a coordinated move of all three to 6.20.0 stays green, and the baseline re-seats from it", () => {
      const moved = withPrisma(withClient(withAdapter(real, "6.20.0"), "6.20.0"), "6.20.0");
      expect(problems(moved)).toEqual([]);
      expect(problems(reseat(moved, "6.19.3"))).toEqual([]);
    });

    it("a coordinated move of adapter, client, prisma and both catalog entries to 7.x is red", () => {
      let seven = withPrisma(withClient(withAdapter(base, "7.8.0"), "7.8.0"), "7.8.0");
      seven = withCatalog(withCatalog(seven, "@prisma/client", "^7.0.0"), "prisma", "^7.0.0");
      expect(importerDep(seven.lock, "prisma")?.version).toBe("7.8.0");
      expect(problems(seven).join("\n")).toMatch(/supports Prisma 6 only/);
    });

    it("an unreadable lockfile is reported, never read as green", () => {
      expect(problems({ ...base, lock: "lockfileVersion: '9.0'\n" })[0]).toMatch(/cannot read the set/);
    });
  });
});
