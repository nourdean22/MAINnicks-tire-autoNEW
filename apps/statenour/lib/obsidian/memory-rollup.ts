/**
 * Pick the newest memory IDs to render in Obsidian category rollups.
 *
 * Input MUST already be ordered newest-first using the same stable
 * createdAt DESC, id DESC ordering as the exporter query.
 */
export function pickNewestIdsPerCategory(
  rows: ReadonlyArray<{ id: string; category: string }>,
  perCategoryLimit = 100,
): string[] {
  const limit = Math.max(0, Math.trunc(perCategoryLimit));
  if (limit === 0) return [];

  const counts = new Map<string, number>();
  const ids: string[] = [];
  for (const row of rows) {
    const seen = counts.get(row.category) ?? 0;
    if (seen >= limit) continue;
    counts.set(row.category, seen + 1);
    ids.push(row.id);
  }
  return ids;
}
