# Macro fallback — FRED + BLS + BEA + Census

**Status (2026-08-26): ALL FOUR PROVIDERS LIVE.** Keys set by the operator on
2026-08-26; payload-asserting probe receipt the same morning: BLS OK (keyless
v1 tier) · FRED OK (CPIAUCSL 332.813 @ 2026-07 — the first FRED data since the
2026-08-12 outage) · BEA OK (Ohio personal income 814,428.0 @ 2026Q1) · CENSUS
OK (MARTS 441, 2026 rows). Re-verify any time (reads the RUNNING Railway env,
never a local .env):

```
railway run --service statenour-web -- node ~/.claude/scripts/macro-keys-live-probe.mjs
```

(that probe script is machine-local to the operator's box, not in the repo —
the in-repo confirmation surface is the brief's "Macro source status" footer).

## Why, and why now

The intelligence stack went dark on 2026-08-12 when one credential batch
expired — and macro went dark with it because FRED was the only macro source.
The outage brief's own recommendation, written from inside the outage: *"Stand
up BLS/BEA/Census as fallback macro."* This integration is that. Four
independently-authenticated, free, US-government sources; the two headline
series (CPI, unemployment) are chain-guaranteed to survive any single
credential failure (registry invariant, canaried).

## Auth reality — measured live 2026-08-25, not read off docs

| Provider | Keyless? | Free key | Refusal shape (measured) |
|---|---|---|---|
| **BLS** | **YES** — one v1 POST returned 7/8 candidate series with July-2026 data, no key. v1 limits: 25 series/query, 25 queries/day/IP. | [registration](https://data.bls.gov/registrationEngine/) → v2: 50 series/query, 500 queries/day | bad series id → `Series does not exist` inside a `REQUEST_SUCCEEDED` envelope |
| **BEA** | No — `UserID` mandatory | [signup](https://apps.bea.gov/API/signup/), instant | **refusal inside HTTP 200**: `{"APIErrorCode":"4","APIErrorDescription":"This UserId is not active..."}` — success is asserted on the payload, never `res.ok` |
| **Census** | **No for `/data/timeseries`** — keyless AND dummy-key both 302 into an HTML "Missing Key"/"Invalid Key" page | [signup](https://api.census.gov/data/key_signup.html) | an **HTML body** — the connector detects non-JSON and reports it as a key failure instead of crashing `JSON.parse` |
| **FRED** | No — key on every call | [key page](https://fred.stlouisfed.org/docs/api/api_key.html) | the 2026-08-12 outage key |

## The series — argued for a Cleveland tire shop, not mirrored

11 series, ~11 report lines + a 4-line status footer. Registry (with per-series
"why" and probe receipts): `lib/intelligence/connectors/macro.ts` `MACRO_SERIES`.

| Series | Chain | Why it earns the line |
|---|---|---|
| CPI (all items, SA) | FRED → BLS | headline inflation; BLS is the origin agency so the fallback is the same series |
| Unemployment (US) | FRED → BLS | same-series fallback, chain-guaranteed |
| Fed funds | FRED only | Fed-only; a fake fallback would be worse than a visible gap |
| Consumer sentiment (UMich) | FRED only | deferral mood for a deferrable purchase; UMich is proprietary, served only via FRED |
| CPI Midwest | BLS → FRED* | Cleveland CBSA CPI is bimonthly+lagged; Midwest monthly is the freshest regional price signal |
| Gasoline, Midwest $/gal | BLS → FRED* | drives miles-driven → tire wear AND deferral; Midwest $3.857 vs national $4.094 (2026-M07) justifies regional |
| CPI vehicle maintenance & repair | BLS → FRED* | the shop's own pricing environment |
| PPI tires (wholesale) | BLS → FRED* | the cost side — margin early-warning |
| Unemployment, Cleveland MSA | BLS only | local demand. **Landmine, measured:** the pre-2023 CBSA id (17460) returns "Series does not exist" — the 2023 OMB re-delineation moved Cleveland to CBSA **17410** (`LAUMT391741000000003`, 3.1% @ 2026-M07) |
| Ohio personal income (quarterly) | BEA | customer capacity to spend; the only sub-annual income read |
| Retail: motor vehicle & parts dealers (SA) | Census MARTS 441 | the sector demand cycle — closest monthly "are people spending on vehicles" series that exists |

\* FRED mirror ids for BLS-native series are **unverified** (FRED requires a key
even to probe); a wrong mirror fails soft per-series and shows as FAILED in the
status footer — it cannot fabricate or hide.

**Deliberately dropped:** wholesale FRED mirroring, GDP, housing. Consumer
sentiment kept but FRED-only (honest gap when FRED is dark, stated in the
footer). Reopen a dropped series only with a named operational question it
answers.

## Failover is observable, never silent

Sources publish the same concept with different adjustments, so numbers differ
slightly across sources — an operator comparing week to week must know the
source changed. Every fallback-served line reads
`— source: BLS (fallback; FRED did not serve)`; primary-served lines stay
clean; unresolved series are **listed as UNAVAILABLE**, never omitted.

## Zero series fails loudly

`macroFetchFailure()` mirrors the brief's `ingestionFailure` contract: zero
indicators with ≥1 provider attempted returns an operator-facing reason chain
naming **every provider's state** ("FRED: HTTP 400 | BLS: network down | BEA:
dormant — set BEA_API_KEY"), and the ingest branch returns `success: false`
with that message — feeding the existing zero-ingest alert chain. A macro
report with no numbers can never ingest as a quiet success.

## Activation — DONE 2026-08-26, traps recorded for the next key rotation

`BEA_API_KEY` + `CENSUS_API_KEY` + `FRED_API_KEY` are set in Railway →
statenour-web (`BLS_API_KEY` optional — keyless serves; the key only retires
the shared-egress-IP quota caveat). Railway auto-redeploys on a CLI
`railway variables --set` (~1 min, env-only restart, no rebuild).

Observed live during activation — the traps a future rotation will hit:

- **Key shapes are diagnosable without reading values**: BEA = 36-char UUID
  *with dashes*; FRED = 32-char bare hex. The FRED key landed in the BEA slot
  twice during activation and was caught by shape (`len 32, hex`) — probe the
  shape, never print the value.
- **BEA error codes disambiguate the fix**: `APIErrorCode 1 "Invalid API
  UserId"` = the stored VALUE is wrong (re-paste); `APIErrorCode 4 "not
  active"` = the value is right and only the email activation click is
  missing. Both ride inside HTTP 200.
- **One transient BLS block-page blip** (HTML instead of JSON on a single
  keyless call) was observed; the immediate retry served normally — not
  quota, not an outage. The probe's keyless-BLS positive control is what made
  it visible.

## Canaries

`tests/intelligence/macro-fallback.test.ts` — every test carries its positive
control in the same block (re-count: `pnpm exec vitest run tests/intelligence/macro-fallback.test.ts`,
never this prose); 6 mutation probes (fallback inversion,
always-fallback flag, always-healthy judge, dropped dormant footer, positional
Census parsing, silently-dropped unresolved series) each proven RED before
merge. The provider fetchers are tested against the **measured** refusal
shapes above, injected via `fetchImpl` — no network in tests.
