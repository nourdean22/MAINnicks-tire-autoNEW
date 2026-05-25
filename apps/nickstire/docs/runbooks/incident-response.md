# Incident Response Runbook

**Skill port:** B14 · incident-response + on-call-handoff-patterns
**Applies to:** any SEV-1 / SEV-2 production incident affecting nickstire.org, statenour, the SMS gateway, VAPI voice agent, or admin tools.
**Authored:** 2026-05-26.

## Why this doc exists

The 2026-05-24 prerender incident showed the gap · operator caught the problem visually, scrambled to find the right person/agent to fix, ~30 min of degraded site before revert. With a runbook · time-to-recovery cuts to <5 min for known classes, <15 min for novel ones.

## Severity definitions

| SEV | Definition | Examples |
|---|---|---|
| **SEV-1** | Site / app DOWN · all customers impacted · revenue zero | nickstire.org returns 5xx · placeOrder fails · Stripe webhook broken · TiDB unreachable |
| **SEV-2** | Site UP but customer-visible degradation OR partial outage | prerender incident · payment slow · voice agent down · admin slow |
| **SEV-3** | Internal-only OR delayed-visibility issue | cron failure · stale cache · dashboard broken · backup failed |
| **SEV-4** | Cosmetic OR self-healing | a stat tile off · slow background job · one customer affected |

SEV determines response speed · NOT necessarily fix priority. A SEV-3 schema drift can be more dangerous than a SEV-2 if left unfixed.

## Response phases

### Phase 1 · DETECT (target · <2 min from incident start)

How an incident is detected:
- **Automated** · SLO burn-rate alert (per slos.md) fires Telegram
- **Operator** · operator notices visually OR through customer complaint
- **Agentic-auditor** · daily cron flags anomaly (less time-critical)
- **External** · Stripe webhook retry queue · ALG silent failure · D&K integration error

The detection trigger writes the FIRST row into `incident_log`:

```
{ id, sev, detected_at, detected_by ("auto" | "operator" | "agent" | "external"), summary, status: "open" }
```

### Phase 2 · TRIAGE (target · <5 min)

3 questions:

1. **Is the bleed contained?** · is the failure mode getting worse, or is it stable? Worsening = SEV-1 escalation regardless of initial SEV.
2. **Is revert possible?** · can we ship a git revert in <5 min OR is fix-forward required?
3. **Who/what can act?** · operator + fix-session agent OR is this beyond both?

### Phase 3 · MITIGATE (target · <15 min for SEV-1 · <30 min for SEV-2)

Mitigation IS NOT root-cause fix. The job is to stop the bleed, not to understand it.

**Standard mitigation playbook · in order:**

1. **Revert last deploy** · if the incident started within 1h of a deploy, revert is the default
2. **Disable the failing surface** · feature flag OFF · cron disabled · webhook endpoint 503
3. **Switch to fallback** · Ollama backup vs Anthropic primary · F25e vs Twilio vs both off
4. **Rollback a single file** · `git checkout HEAD~5 -- path/to/file` · ship as a single-file commit
5. **Scale up** · Railway concurrency · TiDB replica failover
6. **External escalate** · Stripe support · TiDB support · D&K integration team

If the playbook doesn't apply, MAKE A NEW PLAYBOOK ENTRY before moving on. Future incidents need it.

### Phase 4 · RESOLVE (target · same day for SEV-1/2)

After mitigation, the actual root-cause fix lands. Often this is a 1-2 day window between mitigation and resolution. The incident stays "mitigated" not "resolved" until the root-cause fix ships AND verifies.

### Phase 5 · POSTMORTEM (target · within 5 business days)

Every SEV-1 and SEV-2 gets a postmortem doc per Wave T (B1 · postmortem-writing port). Template lives at `apps/nickstire/docs/postmortems/`.

The postmortem is NOT for blame · it's for the system. The 5-whys drill identifies STRUCTURAL fixes (not "be more careful next time").

## Communication shape

### Internal (operator + agents)

- **Phase 1 (detect)** · Telegram message · "[SEV-X] <one-line summary>"
- **Phase 2 (triage)** · update Telegram · "[SEV-X] mitigation: <playbook step>"
- **Phase 3 (mitigate)** · update Telegram · "[SEV-X] mitigated · root-cause TBD"
- **Phase 4 (resolve)** · update Telegram · "[SEV-X] resolved · postmortem queued"
- **Phase 5 (postmortem)** · Telegram · "[SEV-X] postmortem doc: <link>"

### External (customers)

For SEV-1 customer-visible incidents lasting >5 min:
- Static notice on `/` · "We're experiencing a brief technical issue · please call (216) 862-0005 to place orders"
- Status banner on /tires · "Tire search temporarily unavailable · walk-in pricing the same"
- DO NOT post on social media unless >30 min · most incidents resolve before customers notice

NEVER apologize on the status banner. Just state the action ("call us") · CAN-SPAM-grade communication discipline.

## Known incident classes (catalog as discovered)

| Class | Trigger pattern | Mitigation playbook |
|---|---|---|
| **Asset reference mismatch** | Prerender HTML refs stale hashes | Revert · Wave M defensive 404 prevents worst case |
| **Stripe webhook down** | Half-config detection fires 500 | Restore STRIPE_WEBHOOK_SECRET env var on Railway · accept 500s until restored |
| **SMS gateway down** | F25e returns 4xx/5xx | Audit `via:shop` callsites · ensure twilio fallback unflipped · check shop gateway status |
| **VAPI signature fail** | All tool calls return Invalid signature | Verify VAPI_WEBHOOK_SECRET env not rotated · check VAPI dashboard |
| **TiDB unreachable** | All tRPC mutations 500 · `pg_isready`-equivalent fails | Self-healing should auto-recover · if not, manual restart Railway service |
| **Cron double-fire** | Same SMS sent 2x to customer | Wave A cron lock should prevent · if firing, check `cron_locks` table consistency |
| **Migration drift** | Code references column that doesn't exist | Fire migration via admin tRPC `nickActions.runMigrations` (Wave L pattern) |

Add new classes as they're discovered. Each entry should let a future operator (or agent) recover in <5 min.

## Anti-patterns

### "Fix before mitigate"

Operator sees the bug, tries to debug + fix in real-time · 45 minutes pass · site still down. The job is REVERT FIRST · understand later. Heroics extend incidents.

### "Skipping the postmortem"

"It was a quick one-off, no postmortem needed." Then the same class recurs 2 months later · no record · no learning. EVERY SEV-1/2 gets a postmortem regardless of duration.

### "Postmortem-by-blame"

"Claude shipped the prerender bug" · accurate but useless. The STRUCTURAL fix is what matters · "asset-reference smoke test missing" · "catch-all routing too permissive." Behavior change, not blame.

### "Communication-by-silence"

Operator notices something broken, doesn't update the Telegram thread, fixes silently, never posts a resolution. Other observers (audit session, future operator, the operator themselves) lose the record. The thread IS the record.

## Skill-port lineage

B14 from the audit's Round 2. Companion to:
- Wave T · postmortem-writing (B1) · the doc format for Phase 5
- B2 · slos.md · the detection mechanism
- Wave V · autonomous-action tiers · operator-action thresholds map to SEV escalation
- Memory's prerender postmortem · the worked example

Future · `incident_log` table + structured-status banner CMS · auto-generates the customer-facing notice from a per-class template.
