/**
 * A service that talks to a database must be declared in that database's region.
 *
 * ★★★ THE TRAP, 2026-09-23. `MAINnicks-tire-auto` and `statenour-web` were moved
 * from Railway `us-west2` (California) to `us-east4-eqdc4a` (Virginia), next to
 * TiDB and Neon in AWS us-east-1, because every database round trip from
 * California cost a median 72 ms (apps/nickstire/docs/operations/
 * REGION-LATENCY-2026-09-23.md). The move was done live. `.railway/railway.ts`,
 * the ONLY source of build/deploy config, still said `us-west2` for both, so the
 * next routine `railway config apply` (made for any reason: a watch pattern, a
 * healthcheck) would have moved both web apps back to California. Nothing
 * fails when that happens: no error, no red deploy, only every query ~72 ms slower.
 *
 * ── WHAT IS DECLARED, AND WHY IT IS NOT DERIVED ────────────────────────
 * Where a database physically lives is not in this repo in machine-readable
 * form, and it must not be guessed from an env var name. So the map below is
 * declared by hand, with its source. The COMPLETENESS of the map is enforced
 * instead: every service whose env carries `DATABASE_URL` must appear either
 * in DATABASE_HOMES or in NO_DB_CLIENT with a reason. Adding a database-backed
 * service therefore turns this red until someone records where its database is.
 *
 * Offline: reads `.railway/railway.ts` as text (it imports `railway/iac`, which
 * is not a dependency here). A parse miss FAILS; it never passes silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const IAC = join(REPO, ".railway", "railway.ts");

/** Railway region that sits next to AWS us-east-1 (Virginia). */
const NEXT_TO_AWS_US_EAST_1 = "us-east4-eqdc4a";

/** Service -> the database it owns and the Railway region that database requires. */
export const DATABASE_HOMES = {
  "MAINnicks-tire-auto": {
    database: "TiDB Cloud · gateway01.us-east-1.prod.aws.tidbcloud.com (apps/nickstire/docs/CURRENT-TRUTH.md, target host)",
    region: NEXT_TO_AWS_US_EAST_1,
  },
  "statenour-web": {
    database: "Neon Postgres · aws-us-east-1 (apps/statenour/docs/CURRENT-TRUTH.md)",
    region: NEXT_TO_AWS_US_EAST_1,
  },
};

/** Services that hold a DATABASE_URL env var but never open a connection. */
export const NO_DB_CLIENT = {
  "statenour-worker":
    "apps/worker/AGENTS.md: no DB client, every read/write goes over authenticated HTTP. " +
    "apps/worker/package.json has no prisma/drizzle/pg dependency; DATABASE_URL is unread.",
};

/** The text of one `service("<name>", {...})` block, bounded by the next service. */
export function serviceBlock(src, name) {
  const start = src.indexOf("service(" + JSON.stringify(name));
  if (start === -1) return null;
  const next = src.indexOf("service(", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

/** Region keys of a block's `replicas: { ... }`, or null when absent. */
export function replicaRegions(block) {
  const m = block?.match(/replicas:\s*\{([^}]*)\}/);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"\s*:/g)].map((x) => x[1]);
}

/** Every service name declared in the file. */
export function serviceNames(src) {
  return [...src.matchAll(/\bservice\("([^"]+)"/g)].map((x) => x[1]);
}

const SRC = readFileSync(IAC, "utf8");

for (const [service, home] of Object.entries(DATABASE_HOMES)) {
  test(`${service} is declared in its database's region (${home.region})`, () => {
    const block = serviceBlock(SRC, service);
    assert.ok(block, `${service} not found in .railway/railway.ts; the map above is stale.`);
    const regions = replicaRegions(block);
    assert.ok(regions, `${service}: could not read \`replicas\` from .railway/railway.ts.`);
    assert.deepEqual(
      regions,
      [home.region],
      `${service} declares replicas in ${JSON.stringify(regions)}, but its database is ` +
        `${home.database}. \`railway config apply\` would move the live service there and ` +
        `every database round trip would cross the country again (median 72 ms measured ` +
        `2026-09-23 from us-west2). Declare replicas: { "${home.region}": 1 }.`,
    );
  });
}

test("every service holding DATABASE_URL has a recorded database region or a no-client reason", () => {
  const names = serviceNames(SRC);
  assert.ok(names.length > 0, "parsed zero services from .railway/railway.ts");
  const unaccounted = names.filter((n) => {
    const block = serviceBlock(SRC, n);
    return /\bDATABASE_URL\s*:/.test(block) && !(n in DATABASE_HOMES) && !(n in NO_DB_CLIENT);
  });
  assert.deepEqual(
    unaccounted,
    [],
    `These services carry DATABASE_URL but appear in neither DATABASE_HOMES nor NO_DB_CLIENT ` +
      `(scripts/agent-os/railwayRegion.test.mjs). Record where the database lives:\n` +
      unaccounted.map((n) => `    - ${n}`).join("\n"),
  );
  const stale = [...Object.keys(DATABASE_HOMES), ...Object.keys(NO_DB_CLIENT)].filter((n) => !names.includes(n));
  assert.deepEqual(stale, [], `map names services absent from railway.ts: ${stale.join(", ")}`);
});

// ── MUTATION FIXTURES · the parser must see a wrong region, not just a right one ──

test("MUTATION · a web app left in us-west2 is read as us-west2", () => {
  const src = `service("A", {\n    replicas: { "us-west2": 1 },\n  });\n  service("B", { replicas: { "us-east4-eqdc4a": 1 } });`;
  assert.deepEqual(replicaRegions(serviceBlock(src, "A")), ["us-west2"]);
  assert.deepEqual(replicaRegions(serviceBlock(src, "B")), ["us-east4-eqdc4a"]);
});

test("MUTATION · a second region is visible, and a missing replicas block is null", () => {
  assert.deepEqual(replicaRegions(`replicas: { "us-east4-eqdc4a": 1, "us-west2": 1 }`), ["us-east4-eqdc4a", "us-west2"]);
  assert.equal(replicaRegions(`service("x", { env: {} })`), null);
});
