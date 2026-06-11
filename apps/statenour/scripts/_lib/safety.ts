/**
 * Shared helpers for scripts that talk to the database or AI providers.
 *
 * Every ingest/backfill script should import these helpers at the top
 * of main() so we get:
 *   1. Consistent .env / .env.local loading (tsx doesn't auto-load .env.local)
 *   2. A sanity check that prints what database we're about to write to
 *      and requires an env var to confirm before production writes
 *   3. A single source of truth for the Venice-direct call that all
 *      backfill scripts use (the Vercel AI SDK chokes on Venice's
 *      reasoning_content field outside the Next.js runtime)
 *
 * USAGE:
 *
 *   import { loadEnv, confirmDatabase, callVenice } from "./_lib/safety";
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

// ═══════════════════════════════════════════════════════════
// Venice direct (bypasses the Vercel AI SDK)
// ═══════════════════════════════════════════════════════════

const VENICE_MODEL_DEFAULT = "olafangensan-glm-4.7-flash-heretic";

/**
 * Single Venice API call, no retries.
 *
 * Why not lib/ai/provider.aiChat()?
 * ---------------------------------
 * The Vercel AI SDK's OpenAI-compatible client (used by Venice) silently
 * drops the `reasoning_content` field when it validates the response
 * body, which currently results in "Invalid JSON response" errors when
 * called from a standalone tsx script (outside the Next.js runtime).
 * The same call works fine from a Next.js API route because the SDK's
 * response parser has runtime polyfills loaded there.
 *
 * Raw fetch is simpler, faster, and strictly more reliable for batch
 * jobs. Every ingest/backfill script in scripts/*.ts should use this
 * helper instead of importing from lib/ai/provider.
 */
async function callVeniceOnce(
  system: string,
  user: string,
  timeoutMs: number
): Promise<string | null> {
  const apiKey = (process.env.VENICE_API_KEY || "").trim();
  if (!apiKey) throw new Error("VENICE_API_KEY not set");
  const model = (process.env.VENICE_MODEL || "").trim() || VENICE_MODEL_DEFAULT;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Venice-Privacy": "strict",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        venice_parameters: {
          include_venice_system_prompt: false,
          strip_thinking_response: true,
          disable_thinking: false,
          enable_web_search: "off",
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return content
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?think>/gi, "")
      .trim();
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

/**
 * Venice call with 3 attempts + 1.5s backoff between retries. Previous
 * runs showed ~5% abort rate on the first try — one retry recovers
 * almost all of those without slowing down the happy path.
 */
export async function callVenice(
  system: string,
  user: string,
  timeoutMs = 60_000
): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await callVeniceOnce(system, user, timeoutMs);
      if (result !== null) return result;
    } catch (err) {
      if (attempt === 3) {
        console.error(
          `  [venice] ${(err as Error).message} — giving up after ${attempt} attempts`
        );
        return null;
      }
      console.error(`  [venice] ${(err as Error).message} — retry ${attempt}/3`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}
