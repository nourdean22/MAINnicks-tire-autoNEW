# Campaign report — consolidation mandate, 2026-08-09

The mandate's §7 artifact. Companions: [`AUDIT/2026-08-truth.md`](AUDIT/2026-08-truth.md) (the gate),
[`EXECUTION-LOG.md`](EXECUTION-LOG.md) (chronology), [`BLOCKED.md`](BLOCKED.md),
[`NOUR-ACTION-REQUIRED.md`](NOUR-ACTION-REQUIRED.md) (operator queue).

**Five PRs merged. The gate was the highest-value part of the campaign:** eleven load-bearing claims
in the mandate and its successor documents were false, and the largest deletion here was safe only
because a provider API contradicted what the source code implied.

## What shipped

| PR | What | Receipt |
|---|---|---|
| #1458 | Auth-tier coverage contract for nickstire's 90 tRPC routers; PAT stripped from `.git/config`; the gate's truth doc | `tsc` 0 errors; **430 test files / 5,240 tests passed, exit 0**; +341 / -4 |
| #1459 | VAPI ground truth recorded | docs |
| #1460 | The dead statenour vapi lane deleted — 4 routes, 2 helpers, 1 whitelist entry | `typecheck` 0, `lint` 0 errors; **459 files / 4,996 tests passed, exit 0**; +20 / **-1,020** |
| #1461 | Consent ledger wired at the `sendSms` chokepoint, shipped in shadow | 10/10 new tests; sibling SMS suites 5 files / 102 passed; `typecheck:raw` exit 0; +361 / -13 |
| #1462 | Stage-1.7 closed; the eleventh falsified claim recorded | docs |

Outside the repo: all **5 orphan VAPI tools deleted** at the provider (`tools remaining: 0`).

## What was deleted

| Item | Count |
|---|---|
| statenour API route files (the vapi tool lane) | 4 (762 lines) |
| statenour library helpers, route-only by import grep | 2 (249 lines) |
| Security whitelist entry + its test fixture | 2 |
| Total lines removed in #1460, against 20 added | **1,020 across 10 files** |
| VAPI account tools, all orphaned | 5 (external, not code) |
| Plaintext credentials in `.git/config` | 1 |

statenour API routes went **378 → 374**. Estate counted from the filesystem at report time, not from
any document: statenour 374 API routes / 38 pages; nickstire 90 tRPC routers / 198 client page files.

## Where I was wrong

**The costliest error was mine, not the mandate's.** I read the four statenour vapi routes end to end
and reported them as live customer-facing lanes, warning that deleting them would break calls from
stranded drivers. The code fully supported that reading — secret verification, a Telegram alert to
the shop, comments describing a warm transfer on the hot path. The VAPI account API then showed every
tool was an orphan attached to no assistant, three pointing at `autonicks.com` (a dead Vercel
deployment), and the live number running entirely through nickstire. Those routes had never received
a call. Recorded as failure mode #8 in [`docs/UPSTREAMS.md`](docs/UPSTREAMS.md): **code that describes
live behaviour is not evidence that it runs, and an absent caller in the repo is not evidence that
nothing calls it.**

Claims falsified in the mandate and its successor documents (full table in the truth doc §1):

| Claim | What the repository shows |
|---|---|
| `apps/voice` exists, never audited | Deleted 2026-08-03, five days before the mandate |
| Drizzle schema location unknown; `pgTable` grep returned zero | `drizzle/schema.ts`, **145 `mysqlTable`** — nickstire is TiDB/MySQL, so every Postgres-specific instruction was void |
| A 0-line page file is breaking the build | 635 implemented lines; builds |
| statenour has no Ollama provider | Ollama Cloud is its primary lane (UPSTREAMS row 75) |
| Auth tests, cron auth, webhook hardening, TCPA rails all missing | All four existed; the one real gap was nickstire's tRPC layer, which #1458 closed |
| The estate counts are stale (follow-up critique) | The "correction" came from May/June audit docs; the originals matched the filesystem |

A second built-but-unwired case surfaced in the consent work: `logSmsOptIn()` had been writing
consent rows from three live doors while its reader `hasSmsOptIn()` had zero callers. Written, never
read, deciding nothing. The mandate also named the wrong file for the gate.

## Could not verify

- Whether the duplicate VAPI Receptionist assistant `afcad79e` is referenced from env vars or DB
  rows. Assistant IDs live outside the repo, so it was left in place.
- What share of the customer base carries a consent record — not knowable from inside the repo,
  which is exactly why the gate ships in shadow rather than armed.
- Per-route production usage for statenour. Prod DB access is operator-gated by standing rule, and
  the mandate's `pg_stat_user_tables` query applies only to Neon, not to nickstire's TiDB.
- 90-day traffic/ranking evidence for the legacy nickstire pages (Ahrefs connector unauthenticated).
- A full git-history secret scan — gitleaks is not installed and installs are policy-blocked here.
  Registered as ADOPT-CANDIDATE in `docs/UPSTREAMS.md`; it is what would finally size `ROS-011`/`ROS-012`.
- The LiveKit billing tier (console-only).
- That the generated campaign `.docx` opens in Word. Verified structurally (0 schema-order problems
  across `pPr`/`rPr`/`tcPr`/`tblPr`/`sectPr`, 9 well-formed parts, text round-trip) but never
  rendered — LibreOffice is not installed on this machine.

## Still blocked

Detail in [`BLOCKED.md`](BLOCKED.md). The remainder of stage 3 needs `packages/bridge-client` built,
rewired and proven before anything further is deleted — the mandate's own ordering. Stages 4-6 each
contain items the upstream register already answered, two of them answered the same day the mandate
was written, so every surviving line needs gating before any build.

## Handoff

[`NOUR-ACTION-REQUIRED.md`](NOUR-ACTION-REQUIRED.md) is the live list. Open items: revoke the GitHub
PAT (stripping it did not revoke it); decide the Deepgram key (prepaid, ~$199.998 parked, not
billing monthly); rotate LiveKit and check its billing tier; with counsel, decide whether to arm
`SMS_CONSENT_GATE=enforce` using `consentGateShadowMisses` as the input; review the duplicate VAPI
assistant; Custom GPT wiring, deferred by request.
