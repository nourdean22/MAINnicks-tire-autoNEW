# Exact next action

1. Operator merges **#834** → its deploy unparks the repair leg.
2. Run `requestBeatRepair` on job 660002's beat 1 (visible text artifacts) → prod worker regenerates on pulse → reassembly → second QA verdict → before/after comparison → campaign manifest for reel-660002 → forensic reconstruction. **Item 4 closes at 100%.**
3. Then fix-queue items 2–6 (one verify-then-fix PR), then auto-archival wiring, then critic calibration, then milestone 5 (image-derived Visual Bible from 660002's frames).

Status probe: `pnpm exec tsx scripts/tmp-job-status.mts` (job id inside). Higgsfield had 502 outages today — watchdog retries handle recurrence.
