# Macro fallback — FRED + BLS + BEA + Census

**Status (2026-08-25):** wired end-to-end; **BLS serves TODAY with zero keys**
(keyless v1 tier, measured); FRED uses the existing `FRED_API_KEY`; BEA and
Census are **dormant until the operator sets keys** (an operator-side Railway
env edit — protected operation, never agent-initiated). Dormancy is visible:
the daily brief's macro status footer names every unkeyed provider and its
exact env var.

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

## Activation (operator)

1. Optional today: nothing — BLS already serves keyless.
2. `BLS_API_KEY` (free) lifts BLS to v2 limits.
3. `BEA_API_KEY` arms Ohio personal income.
4. `CENSUS_API_KEY` arms MARTS 441.
5. Set in Railway → statenour-web; next `macro` ingest picks them up. Confirm
   in the brief's "Macro source status" footer — the provider flips from
   `dormant — waiting on <VAR>` to `OK, n series`.

## Canaries

`tests/intelligence/macro-fallback.test.ts` — every test carries its positive
control in the same block (re-count: `pnpm exec vitest run tests/intelligence/macro-fallback.test.ts`,
never this prose); 6 mutation probes (fallback inversion,
always-fallback flag, always-healthy judge, dropped dormant footer, positional
Census parsing, silently-dropped unresolved series) each proven RED before
merge. The provider fetchers are tested against the **measured** refusal
shapes above, injected via `fetchImpl` — no network in tests.
