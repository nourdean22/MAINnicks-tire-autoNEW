#!/usr/bin/env node
/**
 * audit-system-surfaces · the Elon "delete first" companion script.
 *
 * Lists every /(mastery)/system/* page route + counts how many places
 * link to it. Surfaces with low/zero inbound link counts are deletion
 * candidates · the operator's workflow probably doesn't depend on them.
 *
 * What this proves vs what it can't:
 *   ✅ Surface is defined in the codebase
 *   ✅ Number of code-level references (lower = lower coupling)
 *   ❌ Actual click-through rate (need page-view telemetry · not wired)
 *   ❌ Whether the operator has it bookmarked or muscle-memoried
 *
 * The output is a tier list · NOT a delete order. Operator confirms.
 *
 * Usage: pnpm --filter @statenour/web audit:surfaces
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const APP_DIR = join(process.cwd(), "app");
const SYSTEM_ROUTE_PREFIX = "(mastery)/system";

async function walkRoutes(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const next = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walkRoutes(full, next)));
    } else if (e.isFile() && (e.name === "page.tsx" || e.name === "page.ts")) {
      // Strip the file from the prefix · /(mastery)/system/foo/page.tsx → /system/foo
      const routePath = prefix
        .replace(/^\(mastery\)/, "")
        .replace(/^\(.*?\)\//, "")
        .replace(/^\//, "");
      out.push({
        route: "/" + routePath,
        file: relative(process.cwd(), full),
      });
    }
  }
  return out;
}

async function countReferences(routePath) {
  // Recursively grep for the route path in app/ + components/ + lib/.
  const escapedRoute = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dirs = ["app", "components", "lib", "hooks"];
  let count = 0;
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue;
        if (e.name === "audit-system-surfaces.mjs") continue;
        const fullPath = join(e.parentPath ?? dir, e.name);
        try {
          const content = await readFile(fullPath, "utf-8");
          // Count occurrences of the route path as a string · href / push / navigate.
          const regex = new RegExp(`["'\`]${escapedRoute}["'\`/?]`, "g");
          const matches = content.match(regex);
          if (matches) count += matches.length;
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip missing dirs
    }
  }
  return count;
}

(async () => {
  console.log("Scanning /system/* surfaces...\n");
  const systemDir = join(APP_DIR, "(mastery)", "system");
  let routes;
  try {
    routes = await walkRoutes(systemDir, SYSTEM_ROUTE_PREFIX);
  } catch (err) {
    console.error("Could not read", systemDir, ":", err.message);
    process.exit(1);
  }

  const results = [];
  for (const { route, file } of routes) {
    const refs = await countReferences(route);
    results.push({ route, file, refs });
  }

  // Sort by refs ascending (deletion candidates first)
  results.sort((a, b) => a.refs - b.refs);

  const tiers = {
    deleteCandidate: results.filter((r) => r.refs <= 1),
    lowUse: results.filter((r) => r.refs > 1 && r.refs <= 3),
    moderateUse: results.filter((r) => r.refs > 3 && r.refs <= 8),
    coreUse: results.filter((r) => r.refs > 8),
  };

  console.log("=".repeat(70));
  console.log(`SYSTEM SURFACE AUDIT · ${results.length} routes scanned`);
  console.log("=".repeat(70));

  console.log(`\n🗑️  DELETE CANDIDATES (<= 1 inbound ref · ${tiers.deleteCandidate.length})`);
  console.log("   Operator workflow doesn't reach these · safe to retire");
  tiers.deleteCandidate.forEach((r) => {
    console.log(`   ${r.refs.toString().padStart(3)} · ${r.route}`);
  });

  console.log(`\n⚠️  LOW USE (2-3 refs · ${tiers.lowUse.length})`);
  console.log("   One self-link + a sidebar entry · check before deleting");
  tiers.lowUse.forEach((r) => {
    console.log(`   ${r.refs.toString().padStart(3)} · ${r.route}`);
  });

  console.log(`\n📊 MODERATE USE (4-8 refs · ${tiers.moderateUse.length})`);
  tiers.moderateUse.forEach((r) => {
    console.log(`   ${r.refs.toString().padStart(3)} · ${r.route}`);
  });

  console.log(`\n💪 CORE USE (>8 refs · ${tiers.coreUse.length})`);
  console.log("   Heavily linked · do NOT delete without major refactor");
  tiers.coreUse.forEach((r) => {
    console.log(`   ${r.refs.toString().padStart(3)} · ${r.route}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("Elon move: question every requirement · delete what you can.");
  console.log("Ilya move: every surface should generate operator signal · if");
  console.log("it doesn't move Nour toward his stated goals, it's noise.");
  console.log("=".repeat(70));

  console.log("\nTo retire a surface: rm -rf app/(mastery)/system/<name>/");
  console.log("Then verify with: pnpm typecheck && pnpm validate:routes");
})();
