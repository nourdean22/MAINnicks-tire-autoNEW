import fs from "node:fs";
import path from "node:path";

/**
 * Bridge ignore contract (2026-07-25).
 *
 * Any vault folder containing a `.statenour-ignore` marker file is NOT bridge
 * inbox content: the doctor must not validate or rewrite it, the ingest must
 * not quarantine from it or feed it to the knowledge gate, and the watcher
 * should not trigger engine runs for events inside it.
 *
 * Why a marker instead of a hardcoded folder list: the vault is a shared
 * surface. The NOURCITY graphify export ("NOURCITY Codebase Graph", 111
 * machine-generated notes per run, no frontmatter) was being swept into
 * Quarantine seconds after every sync — and 5 digests whose FILENAMES matched
 * inferCategory() were silently ingested into the brain as knowledge
 * candidates on every regeneration. Neither program was wrong in isolation;
 * the folder just had no ownership declaration. The marker lets any exporter
 * declare "this folder is mine, not inbox" without the bridge having to know
 * its name.
 */
export const BRIDGE_IGNORE_MARKER = ".statenour-ignore";

/** True when the directory itself declares it is not bridge inbox content. */
export function dirHasIgnoreMarker(dirPath: string): boolean {
  try {
    return fs.existsSync(path.join(dirPath, BRIDGE_IGNORE_MARKER));
  } catch {
    return false;
  }
}
