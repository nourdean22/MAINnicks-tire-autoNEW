/**
 * Sync routes.ts descriptions to match cities.ts metaDescription +
 * services.ts metaDescription. Idempotent — runs against the on-disk
 * routes.ts and rewrites only the description fields whose path matches
 * a known city or service slug.
 *
 * Why: routes.ts is the prerender source-of-truth (Googlebot reads it).
 * cities.ts/services.ts are the runtime React Helmet source. They had
 * drifted apart over time. This script collapses the drift in the only
 * direction that's safe (data → routes), since cities.ts/services.ts
 * are the more recently maintained, brand-voiced, audit-test-checked
 * versions.
 *
 * Usage:
 *   pnpm tsx scripts/sync-routes-from-data.ts
 *
 * Then run: pnpm tsx scripts/check-meta-divergence.ts → expect 0 divergences.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { CITIES } from "../shared/cities";
import { SERVICES } from "../shared/services";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = path.resolve(__dirname, "..", "shared", "routes.ts");

const SERVICE_SLUG_TO_PATH: Record<string, string> = {
  tires: "/tires",
  brakes: "/brakes",
  diagnostics: "/diagnostics",
  emissions: "/emissions",
  "oil-change": "/oil-change",
  "general-repair": "/general-repair",
  "ac-repair": "/ac-repair",
  transmission: "/transmission",
  electrical: "/electrical",
  battery: "/battery",
  exhaust: "/exhaust",
  cooling: "/cooling",
  "pre-purchase-inspection": "/pre-purchase-inspection",
  "belts-hoses": "/belts-hoses",
  "starter-alternator": "/starter-alternator",
};

interface Sync {
  routePath: string;
  newDescription: string;
}

const syncs: Sync[] = [];

for (const c of CITIES) {
  syncs.push({ routePath: `/${c.slug}`, newDescription: c.metaDescription });
}
for (const s of SERVICES) {
  const routePath = SERVICE_SLUG_TO_PATH[s.slug];
  if (!routePath) continue;
  syncs.push({ routePath, newDescription: s.metaDescription });
}

let routesSrc = fs.readFileSync(ROUTES_PATH, "utf-8");
let updated = 0;
let skipped = 0;

for (const sync of syncs) {
  // Find the route entry: `path: "/foo"` followed by ... `description: "..."`
  // Use a non-greedy match constrained to the same object literal (no inner braces between).
  const escapedPath = sync.routePath.replace(/[/]/g, "\\/");
  const re = new RegExp(
    `(path:\\s*"${escapedPath}",[\\s\\S]*?description:\\s*)"((?:\\\\.|[^"\\\\])*)"`,
    "m",
  );
  const match = routesSrc.match(re);
  if (!match) {
    console.log(`SKIP ${sync.routePath} — not found in routes.ts`);
    skipped += 1;
    continue;
  }
  const currentDescription = match[2];
  if (currentDescription === sync.newDescription) {
    skipped += 1;
    continue;
  }
  // Re-quote the new description: escape backslashes + double quotes for
  // the TS string literal, AND escape "$" → "$$" because String.replace
  // treats "$1", "$&", "$$" etc. as special replacement tokens. (Caught
  // the hard way: the description "From $189..." had $1 expanded to the
  // captured group, mangling the file.)
  const escapedNew = sync.newDescription
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
  const replacementSafe = escapedNew.replace(/\$/g, "$$$$");
  routesSrc = routesSrc.replace(re, `$1"${replacementSafe}"`);
  console.log(`OK   ${sync.routePath}`);
  updated += 1;
}

fs.writeFileSync(ROUTES_PATH, routesSrc, "utf-8");
console.log(`\n${updated} updated, ${skipped} skipped (already in sync or not in routes.ts)`);
