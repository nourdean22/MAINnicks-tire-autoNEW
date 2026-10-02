# Settings page census - 2026-10-02

Input to the ADR-0025 proposal (Settings owns durable operator configuration; System owns machine
operations). Read-only census of `app/(mastery)/settings/page.tsx` -> `components/settings/settings-console.tsx`
at commit `acdd9d7d` (branch `statenour/full-circle-a-exception-coverage`). Nothing here was runtime-verified
against production; "reader" means a code path that reads the stored value, found by opening the file.

## Summary

1. 17 blocks mounted by `settings-console.tsx:142-182` across 4 domains (identity 4, cognitive 3, automation 3, diagnostics 7).
2. 53 interactive controls plus 10 display-only rows, laid out as 56 table rows (four rows bundle sibling controls: the 5 people-scoring inputs, blocklist add/remove, flag search/status filter, graduate/un-grad).
3. Block dispositions: KEEP 8 (IdentityPanel, JournalBrainPanel, PeopleScoringPanel, AiSettingsPanel, IntelligenceFlagsPanel, OperatingRhythmToggle, PushNotificationToggle, TickerDismissalReset) - MOVE 5 (SystemOpsHub, SystemHealthCard, SystemDataCards, CommandSpinePulse, DeployChip) - MERGE 4 (SkillLibraryPanel -> /brain, CronControlPanel -> /system/crons, HQErrorsCard -> /system/logs?view=errors, SystemInfoCard -> /system) - DELETE 0 - DEFER 0.
4. Control dispositions (53): KEEP 29 - MOVE 7 - MERGE 16 - DELETE 1 (Speed Ribbon toggle: write-only) - DEFER 0.
5. Every writable control except one has a grep-verified runtime reader; the exception is the Speed Ribbon localStorage key, whose only reader hook (`hooks/chat/use-chat-speed-ribbon.ts`) is mounted nowhere.
6. All 28 writable feature flags have at least one `getFlag(...)` reader (generated census, section "IntelligenceFlagsPanel"); the 25 `readOnly` rows are display-only ENV mirrors.
7. The cron kill switch is honoured only by the 36 route-dispatched crons (`cronHandler`, `lib/utils/http.ts:388-394`); the 19 active `inngest: true` crons in `config/crons.ts` never pass through it, so for them the switch is write-only.
8. Four Diagnostics cards render nothing on a failed read (`hq-errors-card.tsx:64`, `system-health-card.tsx:138`, `command-spine-pulse.tsx:51`, `deploy-chip.tsx:59-66`), indistinguishable from "healthy".
9. Two blocks are mounted twice today: IdentityPanel and SkillLibraryPanel also render on /brain (`components/brain/memory-tab.tsx:34-35,211-212`).
10. Legacy REST twins still exist for 6 of the writers (`app/api/settings/ai-config`, `app/api/settings/crons`, `app/api/settings/crons/trigger`, `app/api/identity`, `app/api/skills`, `app/api/notifications/subscribe`); `app/api/settings/crons/route.ts:14,24` still reads the deleted `vercel.json` catalog and so returns an empty list.

Class legend: CONFIG = durable operator preference with a runtime reader. OPS = status, health, run/stop, links.
DIAG = read-only display. WRITE-ONLY = no runtime reader found. LOCAL = component-local UI state (no write).

## 1. IdentityPanel (`components/settings/identity-panel.tsx`) - KEEP

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Pin override per axis (8 axes; number 0-100 or blank to clear) | `operator.pinIdentityAxis` (operator.ts:366-376) -> `setManualOverride` (identity-snapshot.ts:808-846) -> `prisma.brainMemory.update` category `identity_snapshot` key `current`, `content` JSON `axes[k].manual` | `buildIdentityContextBlock` (identity-snapshot.ts:852-853) into the chat system prompt via brain-context.ts:328-330; `cross-system-nudge.ts:131-147`; `ultron-ticker.ts:466`; `personal-pulse.ts:439`; `actions-brain.ts:153-158`; `ai-tasks.ts:153-159`; `ai-suggest-goals.ts:157-164`; `resolve-mention.ts:69,132`; `brain-domain.ts:337,367`; `projectIdentityForward` (identity-snapshot.ts:731). All read `manual ?? value`. | Immediate in the writing process (cache invalidated identity-snapshot.ts:829 and nudge cache 841-843); sibling replicas up to 300 s (`IDENTITY_CACHE_TTL_S` identity-snapshot.ts:368) | `prisma.update` on a missing `current` row throws -> toast "pin failed" (panel:161). Readers fall back: brain-context 3 s timeout -> "" (brain-context.ts:329); nudges `.catch(() => null)` | Pinned value wins over computed everywhere (`manual ?? value`); recompute preserves pins (identity-snapshot.ts:396-411, 471) | CONFIG | KEEP |
| Recompute button | `operator.recomputeIdentity` (operator.ts:354-356) -> `computeIdentitySnapshot` (identity-snapshot.ts:444; brainMemory writes tagged source `identity_snapshot` at 504 and 515, read cache invalidated at 551) | Same readers as above (the row they read is rewritten) | Immediate (cache invalidated identity-snapshot.ts:551) | Throws -> toast "recompute failed" (panel:141-143). Normal cadence is the daily 04:30 cron (panel copy:179) | n/a | OPS | KEEP (co-located run-now for its own data; no System home) |
| FreshnessChip reload | none (refetch of `operator.identity`, operator.ts:275-289) | n/a | n/a | tRPC error -> panel stays on last data | n/a | LOCAL | KEEP |

Notes: identity-panel.tsx:146-153 validates 0-100 client-side; the procedure re-validates (operator.ts:369-371).
Second mount: `components/brain/memory-tab.tsx:212` renders the same `IdentityPanel` on /brain; the ADR should name one home.

## 2. JournalBrainPanel (`components/settings/journal-brain-panel.tsx`) - KEEP

All seven controls write through `journal.updateSettings` (journal.ts:757-776) -> `prisma.journalSettings.upsert` id `singleton`
(schema.prisma:2693-2708) and are read through `getJournalSettings` (lib/journal/settings.ts:47-68), which returns
`JOURNAL_SETTINGS_DEFAULTS` (settings.ts:33-41) when the row or table is absent or the read throws (never throws, logs a warn).
No cache: applies on the next journal capture / enrichment. Precedence: DB row > defaults; no env var involved.

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Score every capture (toggle) | `JournalSettings.baselineEnabled` | journal-ingest.ts:742-746 gates baseline XP credit | Next capture | Absent -> default `true` | DB > default | CONFIG | KEEP |
| Baseline XP (slider 0-5 step 0.1) | `JournalSettings.baselineXp` | journal-brain.ts:109 (`baselineXp * weight * groundedXpMultiplier`) | Next grounded credit | Server rejects `< 0.1` (journal.ts:760 `min(0.1)`); UI slider allows 0 (panel:129) -> optimistic value reverts with the red banner (panel:77-81, 219-223) | DB > default | CONFIG | KEEP (fix slider min) |
| Quality floor (number 0-2000 chars) | `JournalSettings.qualityFloorChars` | journal-ingest.ts:745 | Next capture | Absent -> 40 | DB > default | CONFIG | KEEP |
| Grounded bonus (slider 0-5) | `JournalSettings.groundedXpMultiplier` | journal-brain.ts:109 | Next grounded credit | Server rejects `< 1` (journal.ts:763 `min(1)`); UI slider allows 0 (panel:163) -> same revert | DB > default | CONFIG | KEEP (fix slider min) |
| Auto-confirm link (slider 0-1) | `JournalSettings.autoConfirmThreshold` | journal-brain.ts:316-319 (`auto` vs `proposed` link status) | Next enrichment | Absent -> 0.8 | DB > default | CONFIG | KEEP |
| Challenge cadence (every / daily / off) | `JournalSettings.challengeCadence` | journal-brain.ts:358, 402 - only `!== "off"` is tested | Next enrichment | Absent -> "daily" | DB > default | CONFIG | KEEP (note: "every" and "daily" are runtime-identical; no other reader found by grep `challengeCadence` over lib/ app/) |
| Creative intensity (bold / balanced / off) | `JournalSettings.creativeIntensity` | journal-brain.ts:358, 401, 404-406 (bold vs grounded tone; off = no idea) | Next enrichment | Absent -> "bold" | DB > default | CONFIG | KEEP |

## 3. PeopleScoringPanel (`components/settings/people-scoring-panel.tsx`) - KEEP

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| deposit base / deposit per +1 / deposit cap / neglect-repair bonus / power-play (5 number inputs) | staged in local draft only until Save | see Save | n/a | invalid input coerced to 0 locally (panel:118-122) | n/a | CONFIG | KEEP |
| Save | `task.setPeopleXpConfig` (power-atlas.ts:322-339) -> `setSetting("people_credit.weights", input, "mastery")` (lib/services/settings.ts:23-36) -> `UserPreference.value` JSON (schema.prisma:1537-1550) | `resolvePeopleXp` (people-credit.ts:62-72) called by `creditLedgerDeposit` (people-credit.ts:110-150; caller record-interaction.ts:213-214) and `creditPowerPlay` (people-credit.ts:154-171; caller power-plays-runner.ts:122-123) | Within 30 s (`getSetting` cache, settings.ts:4-5,11; same-process write refreshes the cache settings.ts:35) | Absent row -> `PEOPLE_XP_DEFAULTS` (people-credit.ts:30-41); per key, non-finite or negative values are ignored (people-credit.ts:68-70); read error -> `{}` -> defaults | DB override per key > hardcoded default; zod bounds power-atlas.ts:324-330 | CONFIG | KEEP |

## 4. SkillLibraryPanel (`components/settings/skill-library-panel.tsx`) - MERGE -> /brain

Storage: BrainMemory categories `skill` and `skill_pending` (skill-extractor.ts:546-572 `loadCategory`, filters `deletedAt: null`).
All curation goes through `operator.curateSkill` (operator.ts:408-463) with `skillCurationSchema` (validators/settings.ts:91-109).
Runtime readers of the `skill` category: `buildSkillsContextBlock` (skill-extractor.ts:963-993; graduated excluded 966-967) in the
chat prompt via brain-context.ts:325-327 (3 s timeout -> ""); `matchSkillsForTask` (skill-extractor.ts:893-922) in
task-actions.ts:400-411 and 646-657 (reinforce on fail/done); ghost-nick.ts:203-204; cross-system-nudge.ts:135-136; brain-domain.ts:335,535.
No cache: next read. Failure: `loadCategory` skips malformed rows and logs (skill-extractor.ts:558-569); readers `.catch(() => [])`.

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Promote | `curateSkill{action:"promote"}` -> `promoteSkill` (skill-extractor.ts:584) copies `skill_pending` -> `skill` | readers above | Next read | 404 -> toast (panel:135-137) | n/a | CONFIG | MERGE |
| Drop (candidate or active) | `dropSkill(key, kind)` (operator.ts:425-428) | readers above (row gone / soft-deleted) | Next read | 404 -> toast | n/a | CONFIG | MERGE |
| Graduate / Un-grad | `setGraduated` (operator.ts:430-436) -> `content.graduated` | `buildSkillsContextBlock` excludes graduated (skill-extractor.ts:966) | Next chat turn | 404 -> toast | n/a | CONFIG | MERGE |
| Edit trigger + action | `editSkill` (operator.ts:439-446; skill-extractor.ts:996+) | readers above (trigger text, action_sequence[0]) | Next read | 404 -> toast | n/a | CONFIG | MERGE |
| Extract now | `curateSkill{action:"extract_now"}` -> `extractSkillsFromTasks` (operator.ts:412-415) writes new `skill_pending` rows | Candidates list (operator.ts:385-392) | Immediate | Throws -> toast (panel:167-169) | Same job the Sunday 03:00 extractor runs (panel copy:555) | OPS | MERGE |
| Refresh / FreshnessChip | none (refetch `operator.skills`) | n/a | n/a | error banner panel:315 and UNMEASURED empty state panel:511-520 | n/a | LOCAL | MERGE |
| Search filter | none | n/a | n/a | n/a | n/a | LOCAL | MERGE |
| Tabs (candidates / active / graduated) | none | n/a | n/a | n/a | n/a | LOCAL | MERGE |

Why MERGE not KEEP: the identical component is already mounted on /brain (`components/brain/memory-tab.tsx:34,211`), and the
controls curate brain content rather than configure a runtime knob. Config readers are real, so nothing is deleted.

## 5. AiSettingsPanel (`components/settings/ai-settings-panel.tsx`) - KEEP (one MOVE, one DELETE inside)

Storage for the config card: BrainMemory category `ai_config` key `global` (ai-config.ts:10-11, 117-118, 160-177).
Read path `getAiConfig` (ai-config.ts:111-136): 30 s per-process cache (ai-config.ts:99-100); absent row or DB error -> `DEFAULT_AI_CONFIG`
(fail-open, ai-config.ts:122-124, 132-135). `updateAiConfig` invalidates only the local cache (ai-config.ts:182) and swallows write
failures (ai-config.ts:178-180) - a failed persist still returns the merged `next`, so the panel can show a value that never landed.

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Default Mode (auto / standard / deep) | `operator.updateAiConfig` (operator.ts:478-480, `aiConfigPatchSchema` validators/settings.ts:33-80) -> `ai_config.content.defaultMode` | derive-turn-signals.ts:84, 94: `fixedMode = researchCompilerMode ? "deep" : (modeOverride || aiConfig?.defaultMode)`; a fixed mode skips `classifyIntent` (95-98) | Within 30 s (cache) on this replica; immediate for the writing replica | `getAiConfig().catch(() => null)` -> auto-detect (derive-turn-signals.ts:84) | per-request `modeOverride` (client body) > `defaultMode` > `classifyIntent`; `researchCompilerMode` forces deep | CONFIG | KEEP - but "auto" is unreachable: the panel sends `{defaultMode: undefined}` (panel:334-339); `httpBatchLink` has no transformer (trpc-provider.tsx:51-55; `superjson` absent from package.json), so JSON drops the key, `updateAiConfig({})` keeps the stored value, and the UI snaps back (panel:163-164). STRONG INFERENCE, not runtime-verified. Consistent with derive-turn-signals.ts:87-88 ("production has had defaultMode deep since 2026-08-31"). |
| Tool blocklist add (input + Disable) / remove (chip x) | `updateAiConfig({disabledTools})` -> `ai_config.content.disabledTools` (validator max 200 names, validators/settings.ts:66) | prepare-tools.ts:165-170 deletes blocked tools after pruning; 194, 215, 229 keep forced lanes from re-adding them; meta.ts:626-627 refuses `invokeTool` on a blocked name; capability plan prepare-tools.ts:263-266 | Within 30 s | Fail-open to `[]` (DEFAULT_AI_CONFIG ai-config.ts:85) | `disabledTools` beats `alwaysOnTools`, action-intent forcing and the recovery lane (prepare-tools.ts:176-233) | CONFIG | KEEP |
| Reset (ConfirmHold) | `operator.resetAiConfig` (operator.ts:487-489) -> `updateAiConfig({...DEFAULT_AI_CONFIG})` (ai-config.ts:190-199) | same readers | Within 30 s | Same swallowed-write caveat | Resets `disabledTools` to `[]` as well | CONFIG | KEEP |
| Haptic Feedback (toggle) | `haptic.setEnabled` -> localStorage `nour:haptic-enabled` (lib/ui/haptic.ts:22, 63-70) | `isEnabled` (haptic.ts:24-34) on every `haptic.*` call in this browser | Immediate, this device only | Storage blocked -> default true (haptic.ts:30-33) | n/a | CONFIG (device) | KEEP |
| Speed Ribbon (toggle) | localStorage `nour:chat:speed-ribbon` (panel:359) | NONE mounted: the only reader is `useChatSpeedRibbon` (hooks/chat/use-chat-speed-ribbon.ts:27, 48-52) and no component imports it (grep `useChatSpeedRibbon` over components/ features/ app/ hooks/ -> only the hook and its test; grep for the literal key -> panel + hook + test) | n/a | n/a | n/a | WRITE-ONLY | DELETE (or re-mount the ribbon) |
| Cold memory "Sync now" | `operator.syncDrive` (operator.ts:610-625) -> `runDriveIngest` (writes BrainMemory rows; not a setting) | Nick's `searchColdMemory` tool reads the ingested rows (panel copy:296); stats via `operator.coldMemoryStats` (operator.ts:597) | Immediate | Failure text shown 6 s (panel:200-208) | Same pipeline as the `ingest-drive` cron (config/crons.ts active list; operator.ts:602-604) | OPS | MOVE -> /system/crons run-now (it is a cron) |

Removed-by-audit fields (`defaultProvider`, `temperature`, `reasoningEffort`, `webSearch`, `toolEmbeddingsEnabled`) are still accepted by
the schema and still absent from the UI (ai-config.ts:30-37; panel:319-327). `alwaysOnTools` has a reader (prepare-tools.ts:176-184) but
no UI writer anywhere (grep over components/ app/ -> only the panel's type).

## 6. IntelligenceFlagsPanel (`components/settings/intelligence-flags-panel.tsx`) - KEEP

Registry: `FLAG_REGISTRY` (feature-flags.ts:89-683) = 53 keys, 25 `readOnly: true`, 28 writable, 7 `defaultOn: true`.
Write: `operator.setFeatureFlagOverride` (operator.ts:501-589): rejects unregistered (512-517) and `readOnly` (518-523) keys, writes an
`auditEvent` first (532-546, best effort), then `UserPreference` category `feature_flags` upsert / deleteMany (548-558), then forces
`loadFeatureFlagOverrides(true)` (566) and returns `persisted` + `runtimeApplied` (564-572, 581-588); the panel surfaces a saved-but-not-live
notice (panel:65-70). Read: `getFlag` / `getAllFlags` (feature-flags.ts:777-808) through `resolveRawValue` (771-775): readOnly -> raw env only;
otherwise DB override if present else env, trimmed; `computeIsOn` (821-843): unset -> `defaultOn`, `offValue` kill switch, pipe enum, literal.

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Force ON (plain, or ConfirmHold for `NICK_AUTONOMY` / `NICK_CONFIDENCE_TIER`, panel:24, 258-291) | `UserPreference{key:<FLAG>, value:"true", category:"feature_flags"}` | Every writable flag has >= 1 `getFlag("<KEY>")` reader (generated census over lib/ app/ excluding tests and feature-flags.ts; counts getFlag/env): NICK_AUTONOMY 4/0 (autonomous-engine/route.ts:67, nick-action-proposal/route.ts:42, nick-action-execute/route.ts:51, nick-action-approved.ts:53); NICK_CONFIDENCE_TIER 2/0 (confidence-tier.ts:129, trust-ladder.ts:118); NICK_MUTATION_LOCK 2/0 (trpc.ts:83, tool-policy.ts:77); NICK_EVIDENCE_ENFORCEMENT 2, NICK_DEEP_REASONING 2, NICK_CONTEXTUAL_RETRIEVAL 2; ENABLE_SPECIALIST_ROUTING 1/0 (agents/types.ts:74 reads `rawValue`, accepts "true" or "shadow"; the one `process.env` hit is a comment at agents/router.ts:15); the other 21 writable flags 1/0 each | Writing process: immediate (forced reload operator.ts:566). Other replicas: <= 30 s (`CACHE_TTL_MS` feature-flags.ts:688; `triggerBackgroundRefresh` 729-734 is non-blocking). Preloaded per tRPC request (trpc/context.ts:39, 63) and per chat request (chat/route.ts:52); NOT preloaded on `/api/cron/*` or Inngest paths, so a cold process's first cron `getFlag` resolves env | DB read failure -> cache keeps the previous map and logs (feature-flags.ts:720); cache reload failure after a write -> `runtimeApplied:false` (operator.ts:564-572) | env default -> DB override (writable only) -> readOnly rows ignore the DB. `NICK_MUTATION_LOCK` ON blocks every operator mutation including this one (trpc.ts:74-112; fail-closed when unresolvable 94-99): Force ON locks the board out of clearing it (recovery = env var or direct DB row delete) | CONFIG | KEEP |
| Force OFF | `value:"false"` same row | same | same | same | same | CONFIG | KEEP |
| Default (clear override) | `deleteMany` the row (operator.ts:548-551) | same | same | same | env resumes | CONFIG | KEEP |
| Search / status filter | none | n/a | n/a | n/a | n/a | LOCAL | KEEP |
| ENV ONLY rows (25 readOnly flags, panel:212-224) | none (write refused server-side operator.ts:518-523) | each mirrors a raw `process.env` read cited in its own `description` (feature-flags.ts, e.g. NICK_COST_FIREWALL -> provider.ts:827, NICK_JIT_SECTIONS -> jit-sections.ts:43) | On restart / Railway env edit | n/a | env only | DIAG | MOVE -> a System flag board (none exists today: `/system/migrations` redirects to `/system`, next.config.ts:274; `migrations-tracker.ts` is consumed only by `app/api/system/migrations/route.ts` and `routers/system/schema.ts`) |

Stale copy: panel:34 says "37-flag payload"; the registry has 53. `HIGH_RISK_FLAGS` (panel:24) hides plain Force ON and requires a hold.

## 7. CronControlPanel (`components/settings/cron-control-panel.tsx`) - MERGE -> /system/crons

Catalog: `systemAutomation.cronCatalog` (routers/system/cron.ts:93-122) joins `CRONS` (`mode: "active"`, config/crons.ts) with
`listCronControls` (cron-control.ts:77-97) and `getCronStats` (cron-control.ts:249-291, `cronJobLog` 14 d).

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Kill switch (per row) | `systemAutomation.setCronEnabled` (cron.ts:58-72) -> `setCronEnabled` (cron-control.ts:52-74) -> `brainMemory` upsert category `cron_control` key `<jobName>`, `content` JSON `{enabled, updatedAt, note}` | `isCronEnabled` (cron-control.ts:37-49) called ONLY from `cronHandler` (lib/utils/http.ts:388-394) which wraps `/api/cron/*` routes. 36 active crons are route-dispatched; 19 active `inngest: true` crons (cron-heartbeat, operator-morning-brief, quality-bench-weekly, suggestion-improve-weekly, proactive-push-cron, goal-pruner, goal-drift-detector, journal-convergence-scan, journal-thread-dormancy, industry-pull, intelligence-daily-brief, intelligence-weekly-brief, customer-preferences-recompute, diagnose-cron-failure, crm-weekly-followups, content-performance-weekly, approval-sweeper, automation-engine, operating-rhythm) have no `app/api/cron/<name>/route.ts` and never pass through `cronHandler` (lib/inngest/client.ts:58-62; no `isCronEnabled` under lib/inngest/) | Next scheduled fire (route crons) | Absent row -> enabled; parse or DB error -> enabled (cron-control.ts:43-48; fail-open `.catch(() => true)` http.ts:390) | kill switch > schedule for route crons only; `mode` in config/crons.ts is the declared truth and reads neither the switch nor the log (config/crons.ts header) | OPS | MERGE (same `setCronEnabled` service already on /system/crons: `app/(mastery)/system/crons/page.tsx:234`) |
| Fire (per row) | `systemAutomation.triggerCron` (cron.ts:135-145) -> `triggerCronByPath` (cron-control.ts:168-207): HTTP GET `${baseUrl}${path}` with `CRON_SECRET` | the target route; goes through `cronHandler` so a killed cron returns `{skipped:true}` | Immediate | `CRON_SECRET` unset -> `{ok:false, body:"CRON_SECRET not configured"}` (cron-control.ts:172-180); 55 s timeout | For the 19 Inngest-native rows the derived path `/api/cron/<name>` has no route file -> the fetch returns 404 (STRONG INFERENCE; not exercised) | OPS | MERGE (`runManifestCron` on /system/crons, page.tsx:235) |
| Refresh / FreshnessChip | none (refetch) | n/a | n/a | error line panel:255-257 | n/a | LOCAL | MERGE |
| Filter text | none | n/a | n/a | n/a | n/a | LOCAL | MERGE |
| Disabled only | none | n/a | n/a | n/a | n/a | LOCAL | MERGE |
| [runbook] link | none; opens `github.com/nourdean22/MAINnicks-tire-autoNEW/.../docs/runbooks/<file>` (panel:45-57, 305-317) | n/a | n/a | runbook file existence not checked | n/a | LOCAL | MERGE |

Panel footer (panel:399-405) claims "Disabled crons short-circuit inside cronHandler" - true for route crons only.

## 8. SystemOpsHub (`components/settings/system-ops-hub.tsx`) - MOVE -> /system

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| 11 nav links (/system, /system/health, /system/logs, /system/logs?view=errors, /system/crons, /system/actions, /system/ai-cost, /system/calibration, /chat, /brain, /journal) with count badges from `useSystemPulse` (lib/hooks/use-system-pulse.ts:90-108 via `trpcVanilla.system.pulse` -> `buildSystemPulse` system-pulse.ts:109) | none | n/a (display) | 30 s poll (use-system-pulse.ts:87) | fetch failure swallowed (use-system-pulse.ts:101-103) -> pulse null -> badges render `?? 0` (hub:89-112) under a "loading pulse..." label (hub:171-176) | n/a | OPS | MOVE (`/system/page.tsx:27` already mounts `SystemHubGrid`) |
| Freshness label (`opsHubFreshness`, hub:52-58) | none | `dbQuotaExhausted` from system-pulse.ts:131, 374 | same | "degraded" when the Neon quota circuit is open | n/a | DIAG | MOVE |

## 9. HQErrorsCard (`components/ultron/hq-errors-card.tsx`) - MERGE -> /system/logs?view=errors

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| "View all" + per-row deep links to /system/logs?view=errors | none; reads `system.errorsGrouped{sinceHours:24}` (routers/system/schema.ts:79-98 -> `listGroupedErrors` error-log.ts:31-38, `errorLog.groupBy`) | n/a (display) | 2 min refetch, `staleTime:0` (card:59-62) | `if (!data) return null` (card:64): a failed read renders exactly like 0 errors (docblock card:57-58 admits it) | n/a | DIAG | MERGE (`components/system/errors-fingerprints.tsx` consumes the same procedure) |

Docblock still says "surfaces recent errors directly on HQ" (card:4); the only mount is settings-console.tsx:170.

## 10. SystemHealthCard (`components/ultron/system-health-card.tsx`) - MOVE -> /system/health

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Refresh (stale badge or stale-fallback row) | `operator.refreshHealthDigest` (operator.ts:703-705) -> `refreshHealthDigest` (health-digest.ts:516-523) -> `persistHealthDigest` fire-and-forget upsert BrainMemory category `system_health_digest` key `YYYY-MM-DD` (health-digest.ts:480-506) | the card itself via GET `/api/ultron/health-digest` (route.ts:57-90: < 4 h -> persisted row, else recompute, else `staleFallback`) through `useUltronFetch` 15 min client TTL (card:107-111). The only non-tRPC read on the page | Immediate (card refetches after the mutation, card:127-128) | Mutation error swallowed (card:129-131); `if (!data) return null` (card:138) so a failed GET renders like "healthy" (card:139) | nightly `health-digest` cron writes the same row (route.ts:9-11) | OPS | MOVE |
| Expand / collapse | none | n/a | n/a | n/a | n/a | LOCAL | MOVE |
| "Diagnostics ->" and highlight links | none | n/a | n/a | n/a | n/a | DIAG | MOVE |

## 11. SystemDataCards (`components/settings/system-data-cards.tsx`) - MOVE -> /system (MemoryOfDay -> /brain)

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Memory of the day (display) | the READ writes: `getMemoryOfTheDay` (memory-of-the-day.ts:44-60, 128-145) upserts a BrainMemory pick-marker row for the day on first call | n/a | on load | `UnmeasuredLine` on error (cards:277); null on empty | n/a | DIAG | MOVE (brain content, not system) |
| Health trend 7d (display) | none; `system.healthTrend` (health.ts:301-308 -> `buildHealthTrend` system-data.ts:42-47 over `system_health_digest` rows) | n/a | on load | `UnmeasuredLine` on error (cards:42); null when empty | n/a | DIAG | MOVE |
| Error rate 24h (display) | none; `system.errorRateByRoute` (health.ts:315-326 -> system-data.ts:156-182 raw SQL) | n/a | on load | `UnmeasuredLine` on error (cards:154); null when 0 errors | n/a | DIAG | MOVE |
| Integration quotas (display) | none; `system.integrationQuotas` (health.ts:335-337 -> system-data.ts:263) | n/a | on load | `UnmeasuredLine` on error (cards:218); null when no probes (cards:216-219) | n/a | DIAG | MOVE |

## 12. SystemInfoCard (`components/settings/system-info-card.tsx`) - MERGE -> /system

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| tools / arsenal (display) | none; `system.toolsHealth` (health.ts:291 -> `buildToolsHealth` tools-health.ts:75; `SELECT 1` probes 88-90, env presence 133-134) | n/a | on load | row shows "..." | n/a | DIAG | MERGE (`/system/page.tsx:112,118` already queries `system.diagnostics` and `system.healthSummary`) |
| memories (display) | none; `brain.status` (brain.ts:407-432 -> `getStatus` memory-manager.ts:905, one raw COUNT query) | n/a | on load | row shows "..." | n/a | DIAG | MERGE (`/system/page.tsx:115` already queries `brain.status`) |
| database (display) | none; `toolsHealth.dependencies.database.status` | n/a | on load | row shows "..." | n/a | DIAG | MERGE |
| LIVE / STALE dot | none | n/a | n/a | STALE only when BOTH reads fail (card:63, 84-94); one failed read leaves the dot green | n/a | DIAG | MERGE |

## 13. OperatingRhythmToggle (`components/settings/operating-rhythm-toggle.tsx`) - KEEP

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Operating rhythm (toggle; disable needs ConfirmHold 800 ms, toggle:131-139) | `system.setAutopilotFlags` (routers/system/autopilot.ts:56-60) -> `setAutopilotFlags` (autopilot-flags.ts:58-68) merges `{...AUTOPILOT_DEFAULTS, ...flags}` and upserts `UserPreference` key `autopilot_flags`, `value` JSON; the toggle spreads the live map first (toggle:59) so no other key resets | `executeRhythm` (lib/brain/operating-rhythm.ts:129-144): reads the row, disables only on explicit `adhd_operating_rhythm === false`; invoked by the Inngest function `operating-rhythm` (lib/inngest/functions/operating-rhythm.ts:40-48, cron `0 15,16 * * *`, no slot argument) | Next tick (twice daily) | Absent key or row -> ON; DB read error -> ON (operating-rhythm.ts:133-135); JSON parse error -> ON (141-143) | The flag is the first gate inside the function; the cron kill switch on /settings does NOT reach this Inngest-native cron (section 7); config/crons.ts `mode: "retired"` is the other off switch (operating-rhythm.ts docblock 29-31) | CONFIG | KEEP |

The other 9 keys in `AUTOPILOT_DEFAULTS` (autopilot-flags.ts:26-36) have no reader: grep `auto_morning_brief|auto_stale_lead_alert|auto_commitment_check|auto_brain_cycle|auto_drift_escalation|auto_followup_quotes|auto_weekly_targets|auto_revenue_alerts|auto_morning_autopilot` over lib/ app/ components/ (excluding the service) returned nothing. They are stored dead weight, not controls.

## 14. PushNotificationToggle (`components/settings/push-notification-toggle.tsx`) - KEEP

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Push notifications (toggle) | subscribe: browser `pushManager.subscribe` then `system.pushSubscribe` (routers/system/notifications.ts:130-148) -> `saveSubscription` (lib/notifications/push.ts:130-150) upserts `UserPreference` key `push_subscription_<hash>` category `notifications`; unsubscribe: `system.pushUnsubscribe` (:154-160) -> `removeSubscription` (push.ts:152-156). Silent re-sync on mount when permission is granted (hook:61-100) | `getSubscriptions` (push.ts:161-171) inside `sendPush` (push.ts:176); senders: coach-events.ts:191-192, vehicle-detection.ts:314, intelligence-brief.ts:359-360, task-due-reminder.ts:59-60; `pushDriftAlertIfNeeded` exists (drift-detector.ts:219, called os-snapshot/route.ts:53; internals not read) | Next send | `VAPID_PRIVATE_KEY` unset -> `sendPush` refuses and logs (push.ts:318-325); missing public key -> toggle error `vapid_public_key_missing` (hook:126-130); server reject -> `server_rejected` (hook:155-158) | env (VAPID keys) gates all sends; per-device subscription row is the operator preference | CONFIG (device) | KEEP |

Stale copy: toggle:81 promises "leads, revenue milestones, drift detection, and score reminders"; `pushLeadAlert`, `pushRevenueAlert`,
`pushScoreReminder`, `pushPipelineAging` (push.ts:368-435) have zero callers (grep over lib/ app/).

## 15. TickerDismissalReset (`components/settings/ticker-dismissal-card.tsx`) - KEEP

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Reset | `clearAll` (hooks/use-dismissed-ticker.ts:137-140) -> localStorage `nour:dismissed-ticker-items` = `{}` (key at :27) | `BottomPulseTicker` filters items by the dismissed set (components/ultron/bottom-pulse-ticker.tsx:90, 141) | Immediate, this device (cross-tab via `storage` event, hook:99-105) | Storage blocked -> no-op (hook:75-82) | n/a | CONFIG (device) | KEEP |

Stale copy: card:29 and 43 refer to a "top ticker"; `GlobalTopTicker` was deleted 2026-09-01 (`app/(mastery)/layout.tsx:82-85`).
Adjacent rot: each dismissal also POSTs `/api/ultron/ticker/ack` writing `AuditEvent eventType "ticker_acknowledged"` (ack route:39-41); no
reader found by grep `ticker_ack|ticker.ack|tickerAck|eventType: "ticker` over lib/ app/api/ other than the writer.

## 16. CommandSpinePulse (`components/ultron/command-spine-pulse.tsx`) - MOVE -> /system

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Whole card is a link to /system | none; reads `operator.commandCenterState` (operator.ts:715-717 -> `buildCommandCenterState` command-center-state.ts:345, tasks/commitments/missions/goals/brainDump queries 422-496) | n/a | 60 s refetch, `retry:false` (pulse:46-49) | `isError || !state` -> null (pulse:51); clean slate -> null (pulse:60-65): failure and clean are the same pixel | n/a | DIAG | MOVE |

Docblock (pulse:5-9, 22-24) still describes an "Ultron home" mount; the only mount is settings-console.tsx:178.

## 17. DeployChip (`components/ultron/deploy-chip.tsx`) - MOVE -> /system

| Control | Writes (mutation -> model.column) | Runtime reader (file:line) | Applies | Failure behaviour | Precedence | Class | Disposition |
|---|---|---|---|---|---|---|---|
| Chip link to the commit | none; one-shot `utils.system.deployInfo.fetch()` (chip:57) -> `buildDeployInfo` (deploy-info.ts:36-48, pure env read via `getDeployMeta`) | n/a | on mount | silent catch -> null (chip:59-66); hidden in dev (chip:68) | n/a | DIAG | MOVE |

Link target: `GITHUB_REPO = "nourdean22/statenour-os"` (chip:41) while this checkout's remote is `github.com/nourdean22/MAINnicks-tire-autoNEW`
(`git remote -v`) and the runbook links on the same page use that repo (cron-control-panel.tsx:308-309). STRONG INFERENCE that the commit
link is dead; not fetched.

## Incumbent precedence chain

1. Env default. `resolveRawValue` reads `process.env[spec.key]` (lib/feature-flags.ts:771-775); `computeIsOn` treats unset as `defaultOn` (821-823), honours `offValue` kill switches (825), pipe enums and literals (827-842).
2. FLAG_REGISTRY readOnly and the DB override. `readOnly` entries return the raw env and ignore any stored override (feature-flags.ts:773); the write path refuses them (operator.ts:518-523). Writable flags take `UserPreference` rows with `category: "feature_flags"` (model schema.prisma:1537-1550), loaded by `loadFeatureFlagOverrides` (feature-flags.ts:695-725, 30 s TTL at 688), preloaded per tRPC request (lib/trpc/context.ts:39, 63) and per chat request (app/api/ai/chat/route.ts:52), refreshed non-blocking elsewhere (729-734). Writer: `operator.setFeatureFlagOverride` (operator.ts:501-589) with an `auditEvent` row first (532-546) and a forced reload + `runtimeApplied` verdict (564-572).
3. Mutation lock. `operatorProcedure = enforceOperator + mutationGateMiddleware` (lib/trpc/trpc.ts:112); every operator mutation on this page is refused while `NICK_MUTATION_LOCK` is on (trpc.ts:74-110), fail-closed when the flag cannot be resolved (94-99). Tool writes use the same flag (lib/tools/tool-policy.ts:64-95).
4. AutomationPolicy rows. Model schema.prisma:3047-3083; `approvalClass` is `auto | pending | forbidden` (lib/automation/policy.ts:22-26, 45). Consulted at fire time in lib/brain/autonomous-engine.ts:1123-1137: `shouldDefer = rule.approval === "ask" || policyApproval === "pending" || policyApproval === null` (fail-closed: no policy means defer), `forbidden` writes `result: "forbidden_by_policy"` and never executes (1139-1171). Edited via `system.updatePolicy` (routers/system/autopilot.ts:295-323) -> `setApprovalClass` (policy.ts:281-300).
5. Approval gate. Deferred rows are `AutonomousAction.approval = "pending"`, listed by `listPendingActions` (lib/automation/approval-queue.ts:73-110, joined to policies at 83-105) and decided by `decidePendingAction` (approval-queue.ts:158-230; expiry refused at 173-183; `executeApprovedAction` on approve 190-200) through `systemAutomation.decideApproval` (autopilot.ts:448-478), surfaced on /system/actions. `NICK_AUTONOMY` is re-checked at the entry points (app/api/cron/autonomous-engine/route.ts:64-75, nick-action-proposal/route.ts:42, nick-action-execute/route.ts:51, lib/inngest/functions/nick-action-approved.ts:51-57); the `NICK_CONFIDENCE_TIER` escape hatch (autonomous-engine.ts:1172-1181, confidence-tier.ts:129) is the only path that skips the queue.

Parallel chains the Settings page also writes into:
- AI config: per-request `modeOverride` > `ai_config.defaultMode` > `classifyIntent` (derive-turn-signals.ts:78-105); `disabledTools` beats every forcing lane (prepare-tools.ts:165-233).
- Cron kill switch: BrainMemory `cron_control` row > schedule, enforced only in `cronHandler` (http.ts:388-394) for route crons; `pauseAllCrons` in the power panel fans out to the same rows (autopilot.ts:363-366 comment; `applyPowerSetting` not opened - CLAIM).
- Autopilot flags: `UserPreference` `autopilot_flags` > defaults, read only by `executeRhythm` (operating-rhythm.ts:129-144).
- Identity pins: `manual` > computed everywhere (`manual ?? value`), surviving recompute (identity-snapshot.ts:396-411, 471).

## Not established

1. Whether the Default Mode "auto" defect reproduces in production (inferred from the absence of a tRPC transformer; no request was sent).
2. Whether `github.com/nourdean22/statenour-os` mirrors the deployed SHAs (DeployChip link); not fetched.
3. Whether the 11 runbook files named in `CRON_RUNBOOKS` (cron-control-panel.tsx:45-57) exist under docs/runbooks/.
4. What `applyPowerSetting("pauseAllCrons")` writes (system-pages-b.ts not opened; cited from the autopilot.ts:363-366 comment only).
5. Whether `pushDriftAlertIfNeeded` (drift-detector.ts:219) calls `sendPush` (file not opened).
6. Production values of `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `NICK_MUTATION_LOCK` and the DB override rows (no prod access in this session).
7. Live row counts for `cron_control`, `feature_flags`, `push_subscription_*` and `ai_config` (code-grep is not evidence of rows).
8. Which of the two IdentityPanel / SkillLibraryPanel mounts (/settings vs /brain) the operator actually uses.
9. Whether `/api/settings/crons/route.ts` (reads the deleted vercel.json via `listScheduledCrons`, cron-control.ts:222-244) has any remaining caller; the trigger twin `/api/settings/crons/trigger` is referenced by config/crons.ts docs as a manual path.
10. The `memories` count on SystemInfoCard and `/system` overview come from the same `brain.status` query; whether they ever disagree in production is unmeasured.

## Route usage (Railway http logs, read 2026-10-02 ~11:30Z, service statenour-web)

Measured by the orchestrating session, not the census agent, from `get-logs types:["http"]` with a path filter and
limit 50 (the tool returns the 50 most recent matching lines; the span of their timestamps is the measurement):

| Path | 50 most recent lines span | Rate |
|---|---|---|
| `/proof` | 2026-09-21 -> 2026-10-02 (11 days) | about 2 views/day |
| `/settings` | under 2 days | heavy; several views/hour while the operator is active |

Reading: /settings is a daily surface, so what it shows is what the operator sees most. The seven Diagnostics blocks that can
render "clean" on a failed read (finding 8) sit on the page the operator reads most often; /proof is close to unvisited.
Route-level counts only; Railway http logs do not identify which block on the page was looked at.
