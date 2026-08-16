# Brain archive — the backup the Obsidian export was never doing

## The two jobs, and why one file could not do both

`scripts/export-brain-to-obsidian.ts` writes category **rollup markdown** into the
vault. It caps each category at `slice(0, 100)` so Obsidian does not choke on a
huge note, and it filters `deletedAt: null`.

That cap is **correct for reading**. It also means the vault is not a backup.
Measured 2026-08-16:

```
live memories .................. 18027
reachable in the vault .........  2822   (15.7%)
LOST to the 100-per-category cap 15205
categories truncated ...........    17
```

`archive_document` lost 6,969 rows, `insight` 1,024, `nick_advice` 525. Anything
soft-deleted was absent entirely.

`scripts/export-brain-archive.ts` is the other job: **one JSON object per line,
every memory, nothing excluded** — including soft-deleted rows, with `deletedAt`
preserved so a restore can tell live from tombstoned. Nothing renders it, so no
cap is needed.

First run: **28,108 memories · 18,027 live · 10,081 soft-deleted · 180 categories
· 76.5 MB**.

## Run it

```bash
pnpm exec tsx scripts/export-brain-archive.ts --env <path-to-.env>
```

Writes to `<vault>/Statenour/_archive/`:

- `brain-memories.ndjson` — the archive
- `brain-memories.manifest.json` — counts, per-category totals, export timestamp

Override the destination with `--out <dir>`. It writes to a `.partial` file and
renames on success, so a crash mid-export cannot replace a complete archive with
a truncated one.

## Why this is NOT a Railway cron

The vault is a local Windows path and `OBSIDIAN_VAULT_PATH` is **not set** on the
deployed service. Railway runs Linux containers — there is no such filesystem
there to write to. Adding a cron route would produce a job that fails every night
and looks scheduled, which is worse than not having one.

It has to run on the machine that owns the vault. To schedule it (run once, in an
elevated PowerShell):

```powershell
$action = New-ScheduledTaskAction -Execute "pnpm" -Argument "exec tsx scripts/export-brain-archive.ts --env .env" -WorkingDirectory "C:\Users\nourd\NOURCITY\apps\statenour"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "statenour-brain-archive" -Action $action -Trigger $trigger -Description "Nightly complete brain archive to the OneDrive-synced vault"
```

Deliberately left for the operator to run: registering a scheduled task is a
system change, not an agent-initiative one.

## Why the vault directory

Not for Obsidian to read — it will ignore a `.ndjson`. Because the vault is
OneDrive-synced, which makes the archive an **off-machine** copy without standing
up new infrastructure. The database is primary; this is the did-something-eat-it
copy.

## What this does and does not protect against

**Does:** an accidental purge, a bad migration, a category swept by a prune you
did not intend, or wanting to read what a memory said before it was rewritten.

**Does not:** anything since the last run. It is a snapshot, not replication —
which is the argument for scheduling it rather than remembering to run it.

Related: `lib/brain/memory-tombstone.ts` (hard-deletes now take their embedding
with them) and the 2026-08-16 change making TTL expiry soft-delete, which removed
the main source of silent loss.
