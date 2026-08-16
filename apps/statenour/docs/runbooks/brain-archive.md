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

- `brain-memories.ndjson` — every memory, live and soft-deleted
- `brain-orphans.ndjson` — embeddings whose memory row is gone
- `brain-memories.manifest.json` — counts, per-category totals, export timestamp

## Why orphans get their own file

`vector_embeddings` rows whose `brain_memory` is gone are the **last copy** of
their text — measured 2026-08-16, 100% had no surviving row with the same key.
They are invisible to a `brain_memories` export *by definition*, so a
memories-only archive silently omitted exactly the content most at risk: 2,158
rows / 1.5M chars, including 123 `gmail_thread`.

They are **archived, not restored.** Restoring would put raw content — including
email — back into recall. Archiving preserves the text while it stays
structurally invisible: no memory row means no recall path can reach it. Those
are different decisions, and only one of them is reversible without a PII call.

Separate file because they are a different kind of record (no confidence, no
metadata, no category column — the category is recovered from the content
prefix), and mixing them in would make a restore ambiguous about what it reads.

Override the destination with `--out <dir>`. It writes to a `.partial` file and
renames on success, so a crash mid-export cannot replace a complete archive with
a truncated one.

## Why this is NOT a Railway cron

The vault is a local Windows path and `OBSIDIAN_VAULT_PATH` is **not set** on the
deployed service. Railway runs Linux containers — there is no such filesystem
there to write to. Adding a cron route would produce a job that fails every night
and looks scheduled, which is worse than not having one.

It has to run on the machine that owns the vault.

### Use the wrapper, not `pnpm` directly

Task Scheduler cannot invoke `pnpm` here — it resolves to `pnpm.ps1`, not an
`.exe`. `scripts/run-brain-archive.ps1` handles that, plus three things a bare
command would not:

- **self-updates** the checkout (`fetch` + `merge --ff-only`), because a task
  pinned to a stale tree runs code that predates the script it is meant to run
- **refuses to merge** unless `HEAD` is already an ancestor of `origin/main`, so
  it can never resolve a conflict on its own
- **logs every run** to `archive-run.log` beside the archive, and exits non-zero
  on failure — a scheduled job that silently no-ops is worse than no job

Verified working: exit 0, both NDJSON files written, run logged.

### BLOCKED as of 2026-08-16 — one manual step first

The task is **not registered**, deliberately. There is nowhere stable to point it:

- the **primary checkout** `C:\Users\nourd\NOURCITY` is on a DETACHED HEAD,
  **51 commits behind** `origin/main`, and does not contain this script
- it cannot fast-forward: **six tracked files carry uncommitted changes**, and
  four are ~125 lines of genuine runbook edits that are **not on main** —
  `REEL-PIPELINE.md` (+53), `social-pipeline-runbook.md` (+37),
  `REEL-PIPELINE-HANDOFF.md` (+21/-5), `META_TOKEN_RENEWAL.md` (+14)
- `main` is checked out in the `.worktrees/graphify-relabel` worktree, so the
  primary cannot simply switch to it

Registering a task against that tree would produce a job that fails every night
while *looking* scheduled — the same anti-pattern this runbook rejects for the
Railway cron above.

Running the wrapper against it proved the guards rather than assuming them: it
declined the merge ("local changes would be overwritten"), detected the missing
script, exited 1, and left the checkout untouched.

**Decide what happens to those uncommitted docs first** — they look worth
committing, not discarding. Then:

```powershell
cd C:\Users\nourd\NOURCITY
git fetch origin main
git merge --ff-only origin/main

$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\Users\nourd\NOURCITY\apps\statenour\scripts\run-brain-archive.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "statenour-brain-archive" -Action $action -Trigger $trigger -Description "Nightly complete brain archive to the OneDrive-synced vault"
```

Confirm with `Get-ScheduledTask statenour-brain-archive`, and check
`archive-run.log` after the first fire.

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
