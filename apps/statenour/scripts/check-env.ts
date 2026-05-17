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

if (argv.has("--prod")) {
  process.env.NODE_ENV = "production";
}

const health = checkEnvHealth();
console.log(describeEnvHealth());

if (health.missing.length) process.exit(1);
if (!health.atLeastOneAiProvider) process.exit(2);
process.exit(0);
