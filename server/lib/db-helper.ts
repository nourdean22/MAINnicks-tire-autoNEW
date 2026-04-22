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

export async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/**
 * Throwing variant — throws if DB isn't available.
 * Use when you cannot gracefully degrade (e.g. write paths).
 */
export async function requireDb() {
  const d = await db();
  if (!d) throw new Error("Database unavailable");
  return d;
}
