# Headless Obsidian Engine Manual — Statenour OS

The Statenour ↔ Obsidian integration acts as a headless, local-first engine layer. Obsidian operates as an offline markdown data sink, capture sink, durable vault, and export mirror, while the Statenour Web application remains the active command center cockpit dashboard.

---

## ── Environment Configuration ──────────────────────────────────────────

The engine is 100% environment-driven. Configure the following variables in `apps/statenour/.env.local` or on Railway:

| Variable | Description | Default Fallback |
| :--- | :--- | :--- |
| `OBSIDIAN_VAULT_PATH` | Absolute path to your local Obsidian vault folder. | `C:\Users\nourd\OneDrive\Documents\Obsidian Vault` |
| `ICLOUD_SHORTCUTS_PATH` | Absolute path to your iCloud Shortcuts capture directory. | `C:\Users\nourd\iCloudDrive\iCloud~is~workflow~my~workflows` |
| `OBSIDIAN_SYNC_MODE` | Synchronization filter: `"bidirectional"` \| `"obsidian_to_statenour"` \| `"none"`. | `"bidirectional"` |
| `OBSIDIAN_REST_URL` | Local Obsidian REST API Plugin URL (for future features). | `http://127.0.0.1:27124` |
| `OBSIDIAN_REST_TOKEN` | Local Obsidian REST API token. | `""` (disabled) |

---

## ── Command Line Interface (Monorepo Root) ─────────────────────────────

All tasks route through the unified runner:

```bash
# Perform a full synchronization run: Doctor -> Ingest -> Export -> Doctor
pnpm obsidian:sync

# Start the continuous watch daemon (debounced 5 seconds, recursive)
pnpm obsidian:watch

# Run diagnostic checks with auto-repair
pnpm obsidian:doctor --fix

# Print the active status metrics and health checks
pnpm obsidian:status
```

---

## ── Watch Mode & Debouncing Daemon ──────────────────────────────────────

Run `pnpm obsidian:watch` in a persistent terminal window to keep files in sync.

1. **Native Directory Watchers**: Registers recursive watchers on the local vault and iCloud Shortcuts directories.
2. **Debounce Gate**: Any write, create, or delete event triggers a **5-second debounce window** to wait for other concurrent operations (e.g. cloud sync sweeps or document edits).
3. **Synchronization Pipeline**: Sequentially executes:
   - `doctor --fix` (directory restoration, status normalization).
   - `ingest` (moves new/modified Obsidian files into Statenour database).
   - `export` (mirrors Statenour database goals, missions, and reflections back to Obsidian).
   - `doctor` (refreshes the overall engine health metrics).
4. **Heartbeat Signal**: Writes a keep-alive timestamp to `.runtime/obsidian-engine-status.json` every 30 seconds so the Statenour UI knows the daemon is alive.

---

## ── Data Safety & Conflict Resolution ───────────────────────────────────

### 1. Conflict Prevention (SHA Content Hash)
When Statenour exports a note to Obsidian, it computes a `sha256` hash of the note *body content* and embeds it in the YAML frontmatter under the `hash` property along with a `last_synced_at` timestamp.

During subsequent exports:
* The exporter reads the local Obsidian note.
* It compares the `hash` saved in the frontmatter with a fresh hash calculated from the current note body.
* If they match, the file has not been modified in Obsidian. The exporter safely overwrites it with new data from Statenour.
* If they **do not match**, a sync conflict is detected!

### 2. Conflict Handling & Quarantine
When a conflict is detected:
* The user's local modified Obsidian note **remains intact** so their changes are never lost.
* The newer version from Statenour is written to the quarantine conflicts folder:
  `Statenour/Quarantine/Conflicts/<filename>.conflict-YYYYMMDD-HHmmss.md`
* A warning warning issue is written to the dashboard engine status pointing out the conflict.

### 3. Non-Destructive Archival
Legacy rollup exports (`Life Goals.md`, `Active Missions.md`) are archived to `Statenour/Archive/Legacy Exports/` instead of being deleted.

---

## ── Engine Status JSON Schema ──────────────────────────────────────────

Status is saved in `apps/statenour/.runtime/obsidian-engine-status.json`:

```json
{
  "health": "healthy" | "degraded" | "error",
  "lastRunAt": "2026-06-22T19:00:00.000Z",
  "lastDoctorRunAt": "2026-06-22T19:00:00.000Z",
  "lastIngestRunAt": "2026-06-22T18:59:55.000Z",
  "lastExportRunAt": "2026-06-22T18:59:59.000Z",
  "stats": {
    "totalNotes": 125,
    "processed": 125,
    "synced": 124,
    "skipped": 1,
    "failed": 0,
    "quarantined": 0,
    "warnings": 0,
    "failures": 0
  },
  "issues": [
    {
      "type": "WARN" | "FAIL",
      "message": "Error details",
      "file": "relative/path/to/note.md",
      "detected_at": "ISO-Timestamp",
      "suggested_fix": "Fix instructions"
    }
  ],
  "quarantinedFiles": [],
  "config": {
    "vaultPath": "C:\\...",
    "icloudShortcutsPath": "C:\\...",
    "syncMode": "bidirectional",
    "restUrl": "http://127.0.0.1:27124"
  }
}
```
