/**
 * Centralized db() helper — single source of truth for lazy DB access.
 * Import this instead of duplicating the 3-line pattern in every router.
 */
export async function getDb() {
  const { getDb: _getDb } = await import("../db");
  return _getDb();
}
