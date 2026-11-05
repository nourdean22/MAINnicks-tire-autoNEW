> ## 2026-11-05 · Harness in both apps: PCs push a read-only snapshot, Nick reads it, cards on /system and /admin · 1 ship
>
> Branch `statenour/harness-apps-connect` (job 2026-11-05-harness-apps-connect). Nour: "i also want both apps/websites
> especially the chat and the admin connnected to the herness".
>
> - Sender: `scripts/agent-os/harness-snapshot.mjs` (every 5 min, `scripts/register-harness-snapshot-task.ps1`) posts to
>   `POST /api/devices/harness` (device door). Storage is `RunnerNode` (`harness:<pc>`), so no table and no migration.
> - Read: `lib/services/harness-status.ts`. Older than 15 min reads UNKNOWN with last-seen and drops the numbers. A
>   source a PC could not read is null plus a reason, never zero. Consumers: `getHarnessStatus` (Nick),
>   `trpc.system.harnessStatus` (`components/system/harness-panel.tsx` on /system), `/api/nour-os/query`
>   `harness_status` (nickstire `nourOsBridge.harnessStatus`, `HarnessCard` on Settings > Status).
> - `getSystemHealthSnapshot` now skips `harness:` rows: a PC must not read as the live runner.
> - Code graph and vault rows (Nour 10:41 EST): server, built commit and commits behind from the PC's `[health]` line
>   and GRAPH_REPORT.md; last export from the `obsidian_engine` status row, live count from `BrainMemory`, the vault
>   graph from the PC. The exported count reads unknown until the export writes `lastExportCount` to that status row.
> - GUARD: the schema is strict and refuses paths and addresses in any string. Read-only: no path from a site to a PC.
