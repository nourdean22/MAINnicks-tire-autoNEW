# nickstire Scan Calibration Ledger

Persistent ledger for ScanFinish-protocol runs scoped to **nickstire** (admin,
Instagram, SMS, booking). The sibling ledger for bdnick/statenour is
`apps/statenour/docs/MISSION-CALIBRATION-LEDGER.md` — do not mix them; they
track different products.

**Next scan: read this file FIRST**, then diff against the trailing 7 days of
`git log`, then `plan-gate` (UPSTREAMS.md · CURRENT-TRUTH.md). The measured base
rate for pasted nickstire/IG plans is **~60-85% already built** (23 gated plans
through 2026-08-12; the IG family alone came back ~85% incumbent five times).

## Calibration rules (inherited from the bdnick ledger, plus two local)

1. `HIGH` conviction requires OBSERVED evidence — a file, a probe, a run.
2. `REPEAT HIT` only if the signal survives a later scan and no kill shot fired.
3. Downgrade any finding whose cheap test fails.
4. Track accepted / rejected / waiting separately; silence is not confirmation.
5. Gate against incumbents BEFORE ranking.
6. Re-measure any number quoted as a thesis. Stale snapshots survive in code
   comments and prior audits long after the state they describe is fixed.
7. **(nickstire-local)** A prod flag read from memory is at most INFERRED —
   `.env` and code comments are not production. Re-read Railway or `cron_log`.
8. **(nickstire-local)** Before calling a module dead or live, grep its
   IMPORTERS. "Built, tested, unwired" has been the dominant defect shape here.

## Run 1 — 2026-08-13 (HEAD `f585dffe2`)

Scope: Instagram abilities in the admin · Nick from the home screen +
check-tasks widget · SMS capability · calendar integration.
Evidence base: this checkout + a local run of `scripts/check-capability-ledger.mjs`.
**No prod probe and no web sweep were run** — every claim depending on a Railway
env var is marked INFERRED for that reason.

### Self-audit of the prior run

| Prior run | Its #1 | Status |
|---|---|---|
| 2026-08-12 nickstire admin trust-ladder (23rd gated plan, ~60% incumbent) | attributed audit ledger + `admin_proposals` approval queue | **ACTED ON** — #1541 merged (`c91238a4c`), 0110/0111 applied to prod, `vapi_action_proposals` flipped ON, follow-ups closed in #1548. One human step still owed: hand-review the first ~10 Nick-originated drafts. |
| 2026-08-11 IG comment webhook | cut comment-reply latency from cron to instant | **ACTED ON** — #1504/#1505 merged, subscription ACTIVATED, endpoint live-verified. Real comment POSTs still unobserved. |

### Findings

| ID | Finding | Window | Conviction | Evidence | Score | Outcome |
|---|---|---|---|---|---|---|
| NT-001 | Reel publish lane has no judge; the image lane's fail-closed judge and the 7-lens `criticPanel` both exist and neither covers reels (`criticPanel.ts` has 1 importer — its own test) | OPEN | HIGH | OBSERVED | 15 | NEW · proposed |
| NT-002 | `getReelGenerationSignal` trains reels on the top-8 posts by engagementRate with no `mediaProductType` filter — carousel/image winners steer reel briefs | OPEN | HIGH | OBSERVED | 14 | **REPEAT HIT ×2** (2026-07-31) · still open |
| NT-003 | Published creative burns `DM "KEYWORD"` into pixels; there is no Instagram DM path anywhere in the repo and the webhook subscribes to `comments` only | OPEN | MED | OBSERVED (code) / INFERRED (token scopes, 2d old) | 13 | NEW · proposed |
| NT-004 | SMS autonomy ladder declares a ceiling per automation; nothing reads declared-ceiling vs live rollout mode. Transfer of the statenour wiring census that found 17 severed rules on its first live run | OPEN | MED | OBSERVED (mechanism) | 12 | NEW · proposed |
| NT-005 | Nick-from-home-screen: deep-link substrate is fully built (`/admin?tab=…`, `?igview=`); manifest shortcuts are 5 customer actions and 0 admin; SW precaches 6 customer routes and 0 admin | OPEN | HIGH | OBSERVED | 11 | NEW · proposed |
| NT-006 | Contrarian trade — daily reel cadence as the growth lever, priced against 6.2% reach-to-base, 0.00 saves, 0.049% ER, and a server-side CAPI path never once observed delivering | OPEN | MED | INFERRED | 10 | NEW · forward trade, falsifiable 2027-02 |
| NT-007 | `reel-pipeline-assembly` is the only `exposure: production` capability and its `verificationExpiresAt` is **2026-08-16** — the ledger gate turns fatal in 3 days. It also still carries a REFUTED blocker ("S3 pending") | CLOSING | HIGH | OBSERVED (script run: exit 0, 4 stale non-load-bearing) | 9 | NEW · dated |
| NT-008 | "Calendar integration" is a premise mismatch — the shop is a walk-in, first-come-first-served, 7-day operation with no slot, bay or capacity model anywhere | DEAD (as slot-booking) | HIGH | OBSERVED | 8 | NEW · REFUTED-PREMISE, redirected |
| NT-009 | `detectNoShows` auto-cancels + texts on `preferredDate < CURDATE()` with no ET conversion, on a 24h tier phased by container boot | OPEN | MED | OBSERVED (code) / INFERRED (session `time_zone`) | 7 | NEW · proposed |

### Cut, noted

- Latent-only: `confirmationCalls` computes tomorrow via `toISOString()` (UTC),
  but self-gates to 15:00-17:59 ET, so the UTC day always matches today. It
  breaks the moment that window moves past 20:00 ET. Not a live defect.
- 13 of 48 capabilities sit `unit_verified @ disabled` — a large built-but-dark
  cohort worth its own census, parked behind NT-004.
