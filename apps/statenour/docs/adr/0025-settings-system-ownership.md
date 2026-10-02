# ADR-0025 · Settings is configuration; System owns operations

**Status:** ACCEPTED · 2026-10-02 ET (proposed the same day as ADR-0024; renumbered because 0024 is the Hidden High-Risk Warning ADR)  
**Supersedes:** ADR-0016 only where ADR-0016 made Settings the canonical entry for OPS  
**Scope:** StateNour information architecture and route ownership  
**Decision owner:** Nour

## Context

ADR-0016 (2026-05-15) intentionally folded OPS into Settings because, at that time, the Settings SystemOpsHub was the operator's chosen control-panel entry and a separate QUICK NAV OPS row felt redundant.

The product has since changed materially:

- `/system` is now a substantial first-class control surface with a control tower, Owner Panel, system hub, stale-data, observability, evidence, tool and cron surfaces.
- `/settings` still describes itself as the operator's "live ops console" and mixes durable preferences with system operations.
- UI v2 now has a dedicated `System` destination in the canonical `components/layout/nav-items.ts` registry.
- The current operator intent is explicit: Settings should stop being Ops. System should own machine operation and diagnostics; Settings should own durable operator configuration.

This is an operator-decision supersession, not a bug in ADR-0016.

## Decision

### Settings owns durable configuration

Examples:

- experience preferences
- notification preferences
- Nick behavior preferences that have a real runtime consumer
- autonomy/tool policy preferences
- operator-controlled schedules/automation policy
- feature overrides and emergency controls
- other stable configuration chosen by the operator

A setting must be traceable to storage and at least one runtime reader. Write-only or decorative controls are not valid Settings content.

### System owns machine operation

Examples:

- system verdict and health
- exceptions
- cron execution truth
- integrations
- devices/fleet
- worker/runtime status
- observability
- cost/runtime telemetry
- tool/capability health
- deployment/proof-of-operation diagnostics
- repair and recovery entry points

System should be exception-first. Normality should be compressed rather than represented by a wall of green cards.

### Proof keeps a distinct epistemic role

Proof answers what evidence supports a claim/action/outcome. It may remain a route or become a System subview only after usage/deep-link evidence supports that move. System health and Proof evidence must not become duplicate dashboards.

### Deep links remain valid during migration

Do not delete stable routes merely to simplify navigation. Move entry points and ownership first; remove or redirect only after confirming no material deep-link or agent-routing dependency.

## Consequences

### Positive

- Settings stops competing with System for the same operator job.
- System becomes the canonical machine-health/operations surface.
- The prior architectural contradiction is explicit instead of silently drifting.
- Navigation can be simplified by job and frequency without introducing another registry.

### Costs / risks

- Existing Settings components may have system-operation dependencies and must be moved deliberately.
- Historical docs and agent route hints may still describe Settings as the OPS home.
- Moving UI before semantic ownership is reconciled could create duplicate doors rather than remove them.

## Migration rule

For every Settings block, classify:

- KEEP — durable config with a verified runtime consumer
- MOVE — operational/diagnostic content that belongs to System
- MERGE — duplicate configuration or status presentations
- DELETE — dead/write-only/duplicated control
- DEFER — ownership unresolved

Sequence the visual move after the UI-v2 backlog wave, so the two do not edit the same shared
Settings/System/navigation UI at once.

## Invariant: surface placement does not establish ownership

Where a control's UI lives says nothing about who enforces it. Controls that change agent
authority, tool access or external side effects keep their enforcement and audit in System/Policy
wherever their UI is rendered. Settings may host the switch; it never becomes the safety authority.
The incumbents this contract extends are the flag registry's read-only marking, the tool approval
gate and the `AutomationPolicy` rows.

## Non-goal

Global precedence between preference, policy, capability and emergency control is not decided here.
It is deferred to the first implementation that has to combine them.

## Verification (why this is ACCEPTED)

1. **Settings census:** `docs/design/settings-census-2026-10-02.md` covers every control (store,
   reader, timing, failure mode) with a KEEP/MOVE/MERGE/DELETE/DEFER disposition.
2. **Implemented:** full-circle wave 2, #2884 (`b008b801`, deployed). Settings went from 17 blocks
   to 8 in three domains; ops blocks moved to `/system` or were merged/deleted as duplicates; the
   cron panel moved to `/system/crons`.
3. **One nav registry:** `components/layout/nav-items.ts` remains the only registry.
4. **Sequencing:** UI v2 PR 4 (#2880, `f93469b7`) merged first.
5. **ADR-0016** carries a superseded-in-part note pointing here.
