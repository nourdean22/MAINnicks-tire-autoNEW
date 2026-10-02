# ADR-0024 · Settings is configuration; System owns operations

**Status:** PROPOSED · 2026-10-02 ET  
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

Do not perform the visual move while PR #2880 (`statenour/ui-v2-backlog`) is actively editing shared Settings/System/navigation-adjacent UI.

## Verification required before ACCEPTED

1. Census every Settings control: store, reader, application timing, failure mode, override precedence.
2. Census System/Proof overlap and current route/deep-link usage.
3. Confirm the canonical `nav-items.ts` registry remains the only nav registry.
4. Implement in a post-#2880 UI wave with tests and production screenshots.
5. Update ADR-0016 with an explicit superseded note or cross-link.
