/**
 * Shared helpers for scripts that talk to the database or AI providers.
 *
 * Every ingest/backfill script should import these helpers at the top
 * of main() so we get:
 *   1. Consistent .env / .env.local loading (tsx doesn't auto-load .env.local)
 *   2. A sanity check that prints what database we're about to write to
 *      and requires an env var to confirm before production writes
 *
 * USAGE:
 *
 *   import { loadEnv, confirmDatabase } from "./_lib/safety";
 *
 *   async function main() {
 *     loadEnv();
 *     await confirmDatabase("my-script");
 *     // ... rest of script
 *   }
 *
 * DO NOT import Prisma before calling loadEnv() — prisma's module
 * initialization reads DATABASE_URL at import time, so if .env.local
 * isn't loaded yet, Prisma will point at a placeholder URL.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Load environment variables from .env and .env.local — tsx by default
 * only loads .env, which means scripts miss Neon DATABASE_URL, Venice
 * API keys, and CRON_SECRET. Call this FIRST in every script, before
 * any imports that touch process.env.
 *
 * Values already in process.env take precedence (so CI overrides work).
 */
export function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf-8").replace(/\r/g, "");
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)="?(.+?)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

/**
 * Inspect DATABASE_URL + print a short "you are writing to X" banner.
 * If the URL looks like production (Neon, Railway, Supabase, etc) and
 * the script isn't invoked with CONFIRM_PROD=1, bail out.
 *
 * This is a soft safety net — it won't catch every case but it will
 * prevent "oops I ran the backfill against dev by accident" and "oops
 * I ran delete-everything against prod by accident".
 */
export async function confirmDatabase(scriptName: string): Promise<void> {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    console.error(`[${scriptName}] DATABASE_URL not set. Did you call loadEnv() first?`);
    process.exit(1);
  }

  const isProd =
    /neon\.tech|railway\.app|supabase\.co|\.aws\./i.test(url) ||
    /pooler\./i.test(url);
  const isLocal = /localhost|127\.0\.0\.1/i.test(url);

  // Extract host for display — never log the full URL (credentials)
  let host = "(unknown)";
  try {
    host = new URL(url).host;
  } catch {
    host = url.slice(0, 40) + "...";
  }

  const env = isProd ? "PRODUCTION" : isLocal ? "LOCAL" : "UNKNOWN";
  console.log(`[${scriptName}] Target DB: ${env} — ${host}`);

  if (isProd && process.env.CONFIRM_PROD !== "1" && process.env.ALLOW_PROD_WRITES !== "1") {
    console.error("");
    console.error("⚠  This script is about to write to a production database.");
    console.error("   Set CONFIRM_PROD=1 to proceed, or run against a local dev DB.");
    console.error(`   Target: ${host}`);
    console.error("");
    process.exit(1);
  }
}


