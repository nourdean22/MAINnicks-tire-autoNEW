/**
 * Paging for the Obsidian memory rollups. No memory is dropped for size: a
 * category larger than ROLLUP_PAGE_SIZE is split across several notes so each
 * one stays quick to open.
 *
 * Pages fill OLDEST-first with fixed boundaries, so a new memory only changes
 * the last page of its category and every earlier page stays byte-identical
 * (the writer then skips it instead of churning OneDrive).
 *
 * Page 1 keeps the plain `<CATEGORY>.md` name every earlier export used; pages
 * 2 and up are `<CATEGORY>_PART_002.md`, and so on.
 */
export const ROLLUP_PAGE_SIZE = 200;

/** Matches only the page files this exporter creates (page 2 and up). */
export const ROLLUP_PART_RE = /_PART_\d{3,}\.md$/;

/** Filename stem for a category. Distinct categories that collapse to one stem share one set of pages. */
export function rollupCategoryName(category: string): string {
  return category.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
}

export function rollupPageFilename(categoryName: string, pageNumber: number): string {
  return pageNumber <= 1
    ? `${categoryName}.md`
    : `${categoryName}_PART_${String(pageNumber).padStart(3, "0")}.md`;
}

/**
 * Split candidate ids into pages per rollup category. Input MUST already be
 * ordered oldest-first (createdAt ASC, id ASC), the same order the exporter
 * query uses.
 */
export function pageIdsByCategory(
  rows: ReadonlyArray<{ id: string; category: string }>,
  pageSize = ROLLUP_PAGE_SIZE,
): Map<string, string[][]> {
  const size = Math.max(1, Math.trunc(pageSize));
  const out = new Map<string, string[][]>();
  for (const row of rows) {
    const name = rollupCategoryName(row.category);
    let pages = out.get(name);
    if (!pages) {
      pages = [[]];
      out.set(name, pages);
    }
    let last = pages[pages.length - 1];
    if (last.length >= size) {
      last = [];
      pages.push(last);
    }
    last.push(row.id);
  }
  return out;
}

/** Page files in the directory listing that this run did not write. */
export function findStalePageFiles(existingFiles: ReadonlyArray<string>, written: ReadonlySet<string>): string[] {
  return existingFiles.filter((f) => ROLLUP_PART_RE.test(f) && !written.has(f));
}

/** Live memories that never reached a note. Over-exporting (rows added mid-run) is not a shortfall. */
export function exportShortfall(live: number, exported: number): number {
  return Math.max(0, live - exported);
}
