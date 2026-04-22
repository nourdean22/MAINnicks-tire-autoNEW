/**
 * Shared DB helper. One import path for every router/service/pipeline.
 * Eliminates 30+ duplicated `async function db() { ... }` snippets.
 *
 * Usage:
 *   import { db } from "../lib/db-helper";
 *   const rows = await (await db()).select().from(users);
 *
 * Lazy import of ../db keeps module-load order stable with existing code.
 */

import type { DB } from "../db";

// Untyped variant — matches the legacy getDb() return. Keeps 200+ call
// sites compiling without churn. Prefer dbTyped() for new code.
export async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/** Typed variant for new code. Returns `DB | null`. */
export async function dbTyped(): Promise<DB | null> {
  const { getDbTyped } = await import("../db");
  return getDbTyped();
}

/**
 * Throwing variant — throws if DB isn't available.
 * Use when you cannot gracefully degrade (e.g. write paths).
 */
export async function requireDb(): Promise<DB> {
  const d = await dbTyped();
  if (!d) throw new Error("Database unavailable");
  return d;
}
