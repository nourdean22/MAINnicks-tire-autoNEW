# Machine sync: the personal layer

Job `2026-11-03-personal-layer-into-repo`. Nour: "Yes, everything", "I want all my rules and everything across all comps"
(2026-11-03), "Yes, start it" (2026-11-05). This page is the audit of NATTYNOUR's `~/.claude` layer against what
`scripts/agent-os/bootstrap-machine.mjs` installs, read 2026-11-05 on main b75472b4d9.

It is its own file because `MACHINE-SYNC.md` exists only on open PR 3530: a second copy of that file here would be an
add/add conflict for that PR. Once 3530 is merged this page folds into it as the "Personal layer" section.

Labels: FACT (read on NATTYNOUR for this table), INFERRED, NOT CHECKED. Decisions: **vendor** (copy into the repo, bootstrap
installs it), **generate** (bootstrap writes it from `config/agent-os/user-layer.json`), **skip** (with the reason),
**Nour decides** (nothing installs until he says yes).

Nothing here is a secret, a token, an absolute path or a private address. Item names only.

## Skills in `~/.claude/skills` (47 folders, FACT)

The registry `apps/statenour/data/skills-registry.json` lists 1,434 skills from an older generation on another machine
(generated 2026-07-30; 129 critical, 25 offensive). This machine holds 47 folders, so the 1,434 is not this layer (FACT).
"In recall" stays yes for all of them unless the timing section says otherwise.

### Already installed by bootstrap (9, no change)

| Item | Kind | Decision | Reason |
|---|---|---|---|
| using-superpowers, ponytail, karpathy-guidelines, i-have-adhd, verification-before-completion, find-skills, prompt-gallery, steal-like-an-artist, antislop | portable | keep | The always-on set; repo copies exist and bootstrap installs them today. |

### In the repo, not installed at user level (16)

These work inside NOURCITY on every PC through `.claude/skills`, and are missing in any other project on a PC that never had
them. Bootstrap adds them to its install list. An existing machine `description:` is kept, as for the always-on set.

| Item | Kind | Decision | Reason |
|---|---|---|---|
| antislop-code, antislop-copywriting, antislop-human, antislop-layoutmobile, antislop-ui | portable | generate (install) | Machine copies differ from the repo copies; the repo wins and the old file goes to the backup folder. |
| ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review | portable | generate (install) | Differ only by the repo's `triggers:` line. |
| brainstorming, systematic-debugging, test-driven-development | portable | generate (install) | Differ by the `triggers:` line and, for brainstorming, two script files. |
| differential-review, reverse-engineer-anything, supply-chain-risk-auditor | portable | generate (install) | Differ only in SOURCE.md; a machine-only `assets/` folder is left alone. |

### Not in the repo (22)

| Item | Kind | Source, licence (FACT, `gh api` or the local clone) | Registry risk | Decision | Reason |
|---|---|---|---|---|---|
| diagnosing-superpowers | portable | obra/superpowers, MIT | not listed | vendor | Byte-identical to upstream 8ca22dba. |
| dispatching-parallel-agents | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| executing-plans | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; ships two shell scripts, read before the copy. |
| receiving-code-review | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| requesting-code-review | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical to upstream. |
| subagent-driven-development | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; ships three shell scripts, read before the copy. |
| writing-skills | portable | obra/superpowers, MIT | unknown | vendor | Byte-identical; `skill-forge` names it as the TDD doctrine for skills. |
| finishing-a-development-branch | portable | obra/superpowers, MIT | **critical** | **Nour decides** (quarantined) | The guardrail skips any skill the registry marks critical or high. The label comes from the registry's text scan, and `commit` and `bash-pro` carry it too (FACT), so it may be a false alarm (INFERRED). |
| using-git-worktrees | portable | obra/superpowers, MIT | **critical** | **Nour decides** (quarantined) | Same. |
| writing-plans | portable | obra/superpowers, MIT | **critical** | **Nour decides** (quarantined) | Same. |
| anti-slop-writing | portable | adenaufal/anti-slop-writing, MIT (LICENSE in the folder and the local clone at 104fae8c) | not listed | vendor | Upstream reads 404 today (FACT, 2026-11-05): the clone and the kept LICENSE are the provenance. The MIT grant does not lapse. |
| ad-creative, ads, social, video | portable | coreyhaines31/marketingskills, MIT | unknown or not listed | vendor | Junctions into `~/.agents/skills`. The always-on hook tells every PC to use them for ad and reel work, so a PC without them is told to invoke a skill it lacks (FACT). |
| ads-creative, ads-meta, ads-tiktok | portable | agricidaniel/claude-ads, MIT | not listed | vendor | Same reason. |
| humanizer | portable | blader/humanizer, MIT | not listed | vendor | Junction into `~/.agents/skills`; the upstream `.github/` folder stays out. |
| graphify | machine | Graphify-Labs/graphify, Apache-2.0 | no risk field | skip | Installed by its own tool and needs the Python package; other PCs are graph clients by policy (`local-services.json`). The repo profile already says what to do when it is absent. |
| video-cutter | machine | house | not listed | skip | Names NATTYNOUR's own folders and drives tools that exist only there. Not portable until those are parameterised. |
| synced | machine | account bucket | n/a | skip | 733 files that follow the login. Not a skill folder. |

## Hooks

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `~/.claude/hooks/always-on-skills.mjs`, `find-skills-turn.mjs` | portable | keep | Byte copies from `scripts/agent-os/`, installed today. |
| SessionStart `always-on-skills.mjs` | portable | keep, moved to user-layer.json | Installed today. |
| SessionStart `graph-ensure-mcp.mjs --scope global` | portable | keep, moved to user-layer.json | Installed today. |
| UserPromptSubmit `skill-recall.mjs`, `find-skills-turn.mjs`, `prompt-sharpen.mjs`, `graph-recall.mjs` | portable | keep, moved to user-layer.json | Installed today. |
| PreToolUse Bash `rtk hook claude` | needs a tool | generate, only where `rtk` is on PATH | Not installed today. A hook naming a missing binary errors on every Bash call, so it is written only where the lookup finds `rtk`. Whether NicksMax and MECHANICS get the binary: **Nour decides**. |

## `~/.claude/CLAUDE.md`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| Output style rules 1-10, exceptions | portable | vendor into the block | The rules every PC should have. The opening sentence is personal and stays out; the skill names stay. |
| Always-on invocation rules (using-superpowers, ponytail, brainstorming order) | portable | vendor into the block | Short form; the install history stays out. |
| `@RTK.md` import | needs a tool | generate, only where `rtk` is on PATH | With `~/.claude/RTK.md`, vendored at `config/agent-os/RTK.md`. |
| Machine layout | machine | skip | Absolute paths and folders of one PC. |
| Three-missing-skills substitution note | portable | skip | `CLAUDE-OPERATING-PROFILE.md` already carries it. |
| graphify pointer | machine | skip | The profile already carries it. |
| The `nourcity-always-on` block | portable | keep | Installed today; this job adds to its source file. One fenced block, no `@import`: the import would point at a path that differs per PC. |

NATTYNOUR keeps its own copy of these lines above the block, so it reads them twice until Nour trims them. Bootstrap never
edits text outside its markers.

## `~/.claude/settings.json` keys

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `skillListingBudgetFraction` | portable | generate | Keeps skill descriptions in the listing. |
| `outputStyle`, `theme` | portable | generate | His setup. |
| `skipWorkflowUsageWarning`, `precomputeCompactionEnabled`, `switchModelsOnFlag`, `inputNeededNotifEnabled`, `agentPushNotifEnabled` | portable | generate | His setup. |
| `extraKnownMarketplaces` (`claude-code-workflows`, `nourcity`) | portable | generate | Public GitHub sources. Listing a marketplace installs nothing. |
| `cleanupPeriodDays` (14) | portable | **Nour decides** | Writing it deletes older session history on a PC that keeps more today. |
| `enabledPlugins` | account | **Nour decides** | 112 on, 69 off across 3 marketplaces, against 7 required (FACT). Copying the list would enable about 105 plugins on a 2-core PC. Bootstrap writes nothing here; `required-plugins.json` stays the check. |

## Permissions

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `~/.claude/settings.json` `permissions` | n/a | nothing to copy | The key is absent: 0 allow, 0 deny, 0 ask (FACT). |
| `~/.claude/settings.local.json` | n/a | nothing to copy | Absent (FACT). |
| `~/.claude.json` per-project `allowedTools` | n/a | nothing to copy | 84 projects, 0 entries (FACT). |
| Primary checkout `.claude/settings.local.json`, entry: one skill by name | machine | **Nour decides** | Untracked, per machine. Bootstrap installs no permission entry. |
| Same file, entry: one scheduled-tasks read tool | machine | **Nour decides** | Same. |
| Same file, entries: two connector read tools (connector ids stay out of this page) | machine | **Nour decides** | Same; the ids are per account. |
| Same file, entries: two `curl` reads of the live sites | machine | **Nour decides** | Same; written for one long-past check (INFERRED). |

Bootstrap refuses a `permissions` key in `user-layer.json` outright. A yes here is a code change in a PR, never a table edit
alone.

## MCP entries in `~/.claude.json`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `graphify` | portable | keep | Installed today (#3533). |
| `vapi-docs` | portable | generate | A public docs URL with no key. |

## Everything else in `~/.claude`

| Item | Kind | Decision | Reason |
|---|---|---|---|
| `.credentials.json` and its temp file | secret | skip | Never read, never copied. |
| Agents, commands, output styles at user level | n/a | nothing to copy | The folders do not exist (FACT). The repo's lane agents and commands already travel by git. |
| `RTK.md` | needs a tool | vendor | See the CLAUDE.md table. |
| `session-skills.md` | machine | skip | A generated index from 2026-10-08, already stale; the profile says it is not a source of truth. |
| `scheduled-tasks/nourcity-heartbeat-*` (4) | machine | skip | They must fire on one PC. Copies on three PCs would run the heartbeat three times. |
| `dev-mods/` | machine | skip | The mod is `.claude/mods/nourcity-harness` (#3545), installed by plugin. |
| `.claude.json` inside `~/.claude` | machine | skip | Ids and migration flags of this install. |
| `projects/` (agent memory and transcripts) | machine | skip | Per machine; may hold private text. |
| `agent-os/`, `backups/`, `bootstrap-backup/`, `cache/`, `debug/`, `file-history/`, `plugins/`, `session-env/`, `sessions/`, `shell-snapshots/`, `state/`, `telemetry/`, `uploads/`, `mcp-needs-auth-cache.json`, `.last-cleanup`, `remote-settings.json.synced-at`, `settings.json.bak*` | machine | skip | Runtime state and backups. |

## Plugin read on the other PCs

Acceptance item 4 of the brief is already done: PR 3544 (b4ccd15e64) taught `plugin-index.mjs` the Desktop stores, and MECHANICS
reads `plugins ok (7 required)` live. Not redone here.
