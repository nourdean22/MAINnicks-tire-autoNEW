# Archived Audits

> Per-file closure mapping. These 5 audits dated 2026-05-05 had their
> recommendations either shipped, superseded, or absorbed into harness
> automation across waves 22-76 (2026-05-06 → 2026-05-07). Archived
> here for historical reference. The active backlog from this era
> lives in `docs/audits/ADMIN_PROBLEMS_2026-05-05.md`.

Archived 2026-05-07 (wave-78) via `pr-review-toolkit:comment-analyzer`
subagent triage.

---

## Per-file disposition

### `2026-05-05-customer-front-audit-v2.md` · ✅ DONE
All title/meta length compliance recommendations shipped. The audit was
already CLEAN on VOICE.md cliché kill list at time of writing; subsequent
waves 31-46 reinforced brand voice (magnetic CTAs, NotFound brand-voice
copy, PillarCallout). Title/meta enforcement now lives in
`scripts/check-meta-lengths.ts` (wave-72). Voice work continues in
`docs/COPY_AUDIT.md` (wave-46).

### `2026-05-05-multi-skill-audit.md` · ✅ DONE
Phone input masking + inline validation shipped via wave-56 BookingWizard
mobile keyboard hints (autoComplete + inputMode + enterKeyHint). Analytics
gaps (form_abandon, GBP UTM) shipped per the audit's own log. VAPI
receptionist live since 2026-05-05. Snippet-hunter and cannibalization
items resolved. Refer to `docs/SESSION_RECONCILIATION_2026-05-07.md` for
the full wave-22→62 map.

### `AUDIT_2026-05-05.md` · 🔄 SUPERSEDED
The master front-to-back audit. Top-5 actions partially shipped: e3f419b
deploy verified, GSC sitemap re-submitted, OverviewSection
partially-refactored (waves 65/73), RBAC scaffolded (wave-59), wire
serviceCityCombinator still pending. §-by-§ findings absorbed into
focused wave-42-62 docs:
- Security headers + posture → `docs/SECURITY_AUDIT.md` (wave-53)
- Database/schema → `docs/DATABASE_AUDIT.md` (wave-52)
- Admin design + observability → `docs/ADMIN_PHILOSOPHY.md` (wave-49) +
  `docs/OBSERVABILITY.md` (wave-51)
- Customer-facing design system → `docs/DESIGN_PHILOSOPHY.md` (wave-42)

### `IMPROVEMENTS_2026-05-05.md` · ✅ DONE (mostly) + 🔄 SUPERSEDED (rest)
Lighthouse CI workflow shipped, verify-prerender workflow shipped, cron
failure observer shipped, AI eval harness shipped (waves 60/62/70 — `pnpm
test:ai-evals`), `<RelatedServices>` wiring shipped (sitemap-services
expanded), BUSINESS.phone centralization pinned by audit-fixes test.
Sentry server-side shim ready; client install gated on operator decision
to pay for Sentry.

### `PUBLIC_SITE_SEO_2026-05-05.md` · ✅ DONE
Per the doc's own §4 "What's Already Defended Against" table — every
defense shipped same-day. The 4 meta trims listed in §2 absorbed into
the wave-71/72 meta-divergence + meta-length harness. Site now passes
`pnpm tsx scripts/check-meta-divergence.ts` (0 divergences) and
`scripts/check-meta-lengths.ts` (ALL ≤170, all contain phone).

---

## NOT archived (active backlog)

`docs/audits/ADMIN_PROBLEMS_2026-05-05.md` — the highest-value still-pending
doc from this era. Items §1 (polling reduction global config), §3 (14 `any`
removals in DispatchSection/ContentSection), §4 (useEffect cleanup gaps),
§6 (staleTime patterns), §10 (autonicks fetch proxy) remain unshipped. §2
(OverviewSection refactor) partially addressed via wave-65 AlertBar
extraction + wave-73 hook fix; §8 (RBAC) scaffolded via wave-59. Status
header at top of that file documents current progress.
