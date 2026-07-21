/**
 * CLI · Validate the runtime environment against the spec in lib/env.ts.
 *
 * Usage:
 *   pnpm exec tsx scripts/check-env.ts                (loads .env.local)
 *   pnpm exec tsx scripts/check-env.ts --prod         (simulates production tier)
 *
 * Exit code 0 = healthy. Exit 1 = missing required. Exit 2 = no AI provider.
 */

import { loadEnvConfig } from "@next/env";
import { checkEnvHealth, describeEnvHealth } from "../lib/env";

const argv = new Set(process.argv.slice(2));

// Use Next's env loader — respects .env.local > .env.development > .env
// priority, and matches exactly what the running app sees.
loadEnvConfig(process.cwd());

// truth-substrate audit P0 (2026-07-21) · finding #13. Pass the mode EXPLICITLY
// rather than mutating NODE_ENV. lib/env.ts used to capture the prod flag at
// import time (this import runs before the assignment below could take effect),
// so `--prod` was a no-op and none of the production-only required secrets were
// ever checked. The env var is still set for any downstream module that reads
// NODE_ENV directly, but validation now uses the explicit mode.
const mode = argv.has("--prod") ? "production" : "development";
if (argv.has("--prod")) {
  process.env.NODE_ENV = "production";
}

const health = checkEnvHealth({ mode });
console.log(describeEnvHealth({ mode }));

if (health.missing.length) process.exit(1);
if (!health.atLeastOneAiProvider) process.exit(2);
process.exit(0);
