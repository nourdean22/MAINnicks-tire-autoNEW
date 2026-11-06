> ## 2026-11-06 · Harness control: allowlisted PC actions through bdnick, Nick as a harness node · 1 ship
>
> Branch `statenour/harness-control-nick-node` (job 2026-11-06-harness-control-nick-node). Nour: "another session
> giving control and ability to use the computers ... Add Nick (agent) to the multi-computer harness as a connected
> node and get it fully functional and operational too".
>
> - Pull, never push: `POST /api/devices/harness/actions` queues a NAME for one PC; the PC's poller
>   (`scripts/agent-os/harness-poll.mjs`, task `NOURCITY-Harness-Poll`) claims it, runs the argv its own checkout's
>   `config/agent-os/harness-actions.json` gives that name, and posts the result. No request field can carry a command.
> - Storage: new table `harness_actions` (migration `20261106180000_harness_actions`, hand-applied, registered in the
>   guarded apply). Audit: `AuditEvent` `harness.action.queued|claimed|finished|refused`. WorkItem was ruled out: any
>   runner key claims every WorkItem type, and its stall reaper pages P0 after 15 minutes.
> - Key: `HARNESS_CONTROL_KEY` on its own header; the snapshot keys never open these doors, and a control key equal to
>   either, or shorter than 32 characters, counts as unset. Bodies over 32 KB are refused before parsing.
> - Claim is a compare-and-swap on the row read; a replayed request key returns the first row; a result is accepted
>   once, from the claiming PC. Unclaimed after 10 min reads EXPIRED and never runs; claimed with no result reads LOST.
> - Neon: an idle PC's 60-120 s poll is answered from an in-process "anything queued?" hint and reads the table at most
>   every 5 minutes. Nick's node `harness:nick` is stamped by the 15-minute device-sentinel tick, so no new waker.
> - Nick: `getHarnessStatus` now carries his node and the last 8 actions (reasons and output fenced);
>   `runHarnessAction` (side-effecting, enum of the four names) and `getHarnessActionResult` (output fenced).
>   The bridge `harness_status` sends nickstire action names and states only.
> - GUARD: before the migration every control door answers 503 "not migrated" and the card shows the action list as
>   unread. Before `HARNESS_CONTROL_KEY` is set, PCs cannot claim, so a queued action expires.
