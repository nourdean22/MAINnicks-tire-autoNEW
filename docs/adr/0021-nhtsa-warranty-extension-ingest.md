# ADR-0021 · NHTSA manufacturer warranty extensions on the work order · a stored nightly ingest

> **Status**: Proposed (2026-10-01) · design note only, no code in this PR
> **Queue item**: Q-50 phase 2 in [`docs/research/2026-09-23-estate-master-architecture.md`](../research/2026-09-23-estate-master-architecture.md)
> §14.4 ("the daily manufacturer-communications file (WPE = warranty extension)"); phase 1 is #2820
> (`9d85850a9`), the NHTSA panel in the work-order drawer
> **Protected core**: no. The build adds two new tables, one daily read-only download from a public
> government host, and one block in an admin-only panel. It sends nothing, it touches no customer
> lane, and it does not change payments, Vapi, SMS, consent or the bridge
> **Decision drivers**: a manufacturer warranty extension is money the customer does not have to
> spend at all, and a repair the shop should not quote blind. Phase 1 shows recalls and complaints
> but not extensions. NHTSA publishes extensions only as a bulk file (no public per-vehicle API),
> so showing them needs a stored copy

---

## 1 · The answer

1. **Ingest NHTSA's Manufacturer Communications TSV, keep only warranty-extension rows, store them
   in two small tables, and read them by year/make/model in the existing NHTSA panel.** The full
   history matched by the rules below is about 2,550 communications and 34,000 product rows
   (measured, §3). That fits in tables this size; no search engine, no blob store.
2. **Two classification signals, both stored, both shown.** NHTSA's own `Communication Type`
   ("Warranty Program/Extension") exists only for rows received since mid-2024. Older rows, and
   GM's "Special Coverage" programs (filed as "Service Campaign"), are found by a narrow summary-text
   rule. Each row records which signal found it, and the panel says so (§4).
3. **Information for the advisor, never a coverage claim.** The panel says "may apply". It names
   the conditions it cannot check (VIN range, mileage, in-service date, sometimes state) and says to
   confirm with the dealer. Nothing reaches a customer, an AI estimate or a text (§7).
4. **A failed or stale ingest shows "unavailable", never "none on file"** — same rule as phase 1
   (§7.3).
5. **Rollout:** migration + ingest job behind a default-OFF flag (phase 2a, operator applies the
   DDL and arms the flag), then the panel block (phase 2b). The phase 1 review's name-matching
   carry-overs ride in phase 2b, because the same make-alias table fixes both (§8).

## 2 · The premise, re-checked against `origin/main` at `d35be1ed2`

| Claim | Reality (2026-10-01) |
|---|---|
| A "daily manufacturer-communications file" exists | **True, with a correction.** It is not one file. It is a set of zip chunks by date *received*, at `https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_<range>.zip`. Every chunk, old ones included, was regenerated on 2026-09-30 between 10:05 and 10:15Z (HTTP `last-modified`). data.gov lists the dataset as `R/P1D` (daily) |
| The file flags WPE | **Only since mid-2024.** The field "Communication Type" was added in the May 2024 schema change (`TSBS.txt` change log item 4). In the 2015-2019 chunk all 2,090,783 rows are typed "Service Bulletin/Repair Instructions" |
| Phase 2 "needs a new table and cron" (phase 1 merge note) | True. No NHTSA table exists (`grep -i nhtsa drizzle/schema.ts`: nothing); `vehicleData.ts` only holds a 24 h in-memory cache of live API answers |
| A live API could replace the ingest | **False.** `api.nhtsa.gov/products/vehicle/manufacturerCommunications?...` answers HTTP 403 `{"message":"Missing Authentication Token"}` (probed 06:42Z) |
| Prior art in this repo | `cron/jobs/warrantyAlerts.ts` is the **shop's own** service-warranty reminder to customers (flag `predictive_maintenance_alerts`), not a manufacturer program. Unrelated; this design must not feed it. `docs/UPSTREAMS.md` rows 100 and 161 cover vPIC + recalls; nothing covers manufacturer communications |

## 3 · The source, measured 2026-10-01 06:43-06:50Z

Layout per `https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS.txt` (change log updated 2026-09-15): tab
separated, no header row, 14 fields, one row per communication × product × any multi-valued
field. Fields used here: 1 `NHTSA ID Number`, 3 `Date Added to File`, 4 `TSB/Document ID`,
5 `Mfr Communication Date`, 6 `Mfr Internal Campaign ID`, 7 `Communication Type`, 8 `Make`,
9 `Model`, 10 `Model Year` (`9999` = unknown), 11 `NHTSA Components`, 14 `Summary` (up to 4,000 chars).

| Chunk | Zip | Rows | Communications | Typed WPE (ids / rows) | Text-rule-only (ids / rows) |
|---|---|---|---|---|---|
| 2015-2019 | 32.9 MB | 2,090,783 | 91,693 | 0 / 0 | 1,056 / 17,601 |
| 2020-2024 | 31.8 MB | 2,404,946 | 73,930 | 154 / 7,507 | 681 / 10,732 |
| 2025-2026 | 11.8 MB (391.7 MB unzipped) | 773,240 | 22,379 | 542 / 8,964 | 117 / 2,787 |

- Across those three chunks the rules match **2,550 communications and 34,151 distinct
  (id, make, model, year) product rows** (recounted 2026-10-01 07:12Z with the §4 rule as
  written; the first draft's counts came from an earlier version of the rule). The four older chunks (1995-2014) were confirmed to
  exist (HTTP 200) but not measured; the build measures them before sizing anything.
- **The current chunk is named `2025-2026`, not `2025-2029`** (404). `TSBS.txt` says "5-year
  chunks"; the live name contradicts it. The ingest must not hard-code the current chunk's name (§6).
- **Mojibake is in the source.** 850 of the matched rows carry double-encoded UTF-8 (`â€™` for
  `’`, `â€¢` for `•`). Repair only the known sequences at parse time; never round-trip the whole
  text through another encoding.
- **Make spelling is not clean.** The matched rows hold `MERCEDES-BENZ`, `MERCEDES BENZ` and
  `MERCEDES-BENz`. Models are narrower than shop speech: `SILVERADO 1500`, `F-150`, `CAMRY HYBRID`.
- A Python scan of the current chunk (unzip + split + filter) took 1.4 s in this container. Node's
  cost is **not measured**; the build measures it (§9).

The CSV variant (`MFR_COMMS_RECEIVED_2025-2026.zip`, 5.3 MB) is smaller, but it has no
`Communication Type` column, and §4 shows the text rule alone misses most typed rows. TSV it is.

## 4 · Classification — what counts as a warranty extension

A row is kept when **either** signal fires. Each stored communication records `signal` =
`nhtsa_type` or `summary_text` (both, if both fire) and the matched phrase.

1. **`nhtsa_type`**: field 7 normalized (lowercase, spaces and `/` removed) equals
   `warrantyprogramextension`. The live value is `Warranty Program/Extension`; the spec spells it
   `Warranty Program / Extension`. Normalizing covers both.
2. **`summary_text`**: field 14 matches, case-insensitively, one of `WARRANTY EXTENSION`,
   `SPECIAL COVERAGE`, `WARRANTY ENHANCEMENT`, `EXTENDED WARRANTY`, `COVERAGE EXTENSION`,
   `EXTENDED (THE )?(NEW VEHICLE )?(LIMITED )?WARRANTY`, or `(WARRANTY|COVERAGE)` followed within
   120 characters by `HAS BEEN EXTENDED`.

Why both, from the 2025-2026 chunk: of 542 typed communications, the text rule alone finds 230 and
**misses 312 (58%)**, for example Hyundai's "Certain 2013-2019 Santa Fe ... engine damage" notice.
And GM files its Special Coverage programs as "Service Campaign" (e.g. 11013460, Chevrolet
thermostat), which the type rule misses.

Precision, sampled by reading (not a measured rate): 25 of 25 random text-rule hits from 2015-2024
were real extension or coverage programs. A bare `HAS BEEN EXTENDED` scored 12 of 15; its misses
were an enrollment window (VW 10122934), a field campaign deadline (Western Star 11007487) and a
letter cycle (Toyota 10134391). That is why the rule requires `WARRANTY` or `COVERAGE` before it.
**The type signal is not clean either**: typed rows include "Warranty Newsletter – Volume 10" (Alfa
Romeo 11011962) and an Isuzu tire-warranty policy (11012609). So the panel shows each summary and
leaves the call to the advisor; nothing downstream acts on the classification.

## 5 · Storage (migration `0138`, or the next free number at build time)

Hand-applied, per `nickstire-tidb-ddl`: VARCHAR not ENUM, widths from the spec's own maximums,
`utf8mb4`.

```sql
-- one row per NHTSA communication that a §4 rule matched
CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_comms (
  nhtsa_id          BIGINT        NOT NULL PRIMARY KEY,      -- field 1, NUMBER(9)
  document_id       VARCHAR(128)  NOT NULL,                  -- field 4
  mfr_campaign_id   VARCHAR(128)  NULL,                      -- field 6
  communication_type VARCHAR(64)  NOT NULL,                  -- field 7 as published
  signal            VARCHAR(32)   NOT NULL,                  -- nhtsa_type | summary_text | both
  matched_phrase    VARCHAR(64)   NULL,
  mfr_date          DATE          NULL,                      -- field 5
  added_date        DATE          NULL,                      -- field 3
  components        VARCHAR(512)  NULL,                      -- field 11 (multi-valued: union)
  summary           TEXT          NOT NULL,                  -- field 14, mojibake repaired
  source_chunk      VARCHAR(32)   NOT NULL,                  -- e.g. 2025-2026
  last_seen_at      TIMESTAMP(3)  NOT NULL,
  KEY idx_last_seen (last_seen_at)
);

-- one row per (communication, product)
CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_products (
  nhtsa_id     BIGINT        NOT NULL,
  make_norm    VARCHAR(128)  NOT NULL,   -- normalized per §8
  model_norm   VARCHAR(256)  NOT NULL,
  model_year   SMALLINT      NOT NULL,   -- 9999 = not stated by the manufacturer
  make_raw     VARCHAR(128)  NOT NULL,
  model_raw    VARCHAR(256)  NOT NULL,
  PRIMARY KEY (nhtsa_id, make_norm, model_norm, model_year),
  KEY idx_ymm (make_norm, model_year, model_norm)
);
```

- Writes are `INSERT ... ON DUPLICATE KEY UPDATE` on the natural keys, so a re-run, a crashed
  half-run or two runners never duplicate a row (`claim-before-act` does not apply: there is no
  "who acts" decision, only an idempotent upsert).
- No foreign key to work orders or customers. These are public facts about vehicle models; they
  hold no PII.
- A communication NHTSA drops from the file stays in the table, but its `last_seen_at` stops
  moving. The read path ignores rows not seen by the latest successful full pass of their chunk.

## 6 · The ingest job

1. **Where:** a new job, `nhtsa-warranty-ingest`, in the nickstire scheduler's daily wall-clock
   tier (`cron/wallClockTiers.ts:74`, which opens at 09:30 ET). That is after NHTSA's
   ~10:15Z (06:15 ET) regeneration, but inside shop hours, so phase 2a must measure the parse's CPU
   and memory on the real chunk before arming (§9, §12). Not the worker: it has no DB client, and
   this job's whole output is DB rows.
2. **Gate:** feature flag `nhtsa_warranty_ingest`, default OFF, added to `FLAG_DEFINITIONS`. A
   missing table (MySQL 1146) returns a skipped status naming the migration, the way
   `bridgeOutbox.ts` and `tireRegistration.ts` treat 1146 — never a silent success.
3. **What it fetches:**
   - Daily: the current chunk only (11.8 MB today).
   - Sunday: all chunks, so revisions to older communications and NHTSA deletions are picked up.
   - First armed run: all chunks.
   - A chunk whose zip entry CRC-32 and uncompressed size (from the zip's central directory; a
     ranged GET of the file's tail is enough to read them) match its last parsed pass is not
     parsed again, and that parsed pass stays the chunk's reference for §5's `last_seen_at` rule.
     `last-modified` is not used: every chunk is regenerated even when its content is unchanged
     (§2). A small key-value row is enough to hold the CRC-32, size and parsed-pass time, e.g. in
     the existing flag or settings store; the build picks one after a `prior-art-grep`, never a
     third new table.
4. **Discovering the current chunk name.** Closed ranges are fixed (`1995-1999` ... `2020-2024`).
   For the open range, probe `2025-<current year>` and then `2025-2029`, and take the first that
   answers 200. If neither does, the run **fails** with "current chunk not found", recorded as
   `failed` in `cron_log`. It never reports success with zero rows.
   > **Added in phase 3 (2026-10-01).** If both miss, the probe tries `<start>-<last year>`
   > last (`previousYearCandidate` in `nhtsaWarrantyParse.ts`), so in January 2027 a
   > still-unrenamed `2025-2026` is found instead of failing. It is skipped when last year is
   > the range's first year or belongs to a closed range; those runs fail loudly as above.
5. **Parsing:** stream the zip entry and split lines as they arrive. Never hold the 392 MB text in
   memory. Proposed unzip: `fflate` (MIT, no dependencies, streaming `Unzip`). It is already in
   `pnpm-lock.yaml` at 0.8.3 through another package; the build adds it as a direct nickstire
   dependency and lists it in `docs/UPSTREAMS.md`. A row whose field count is not 14 is counted and
   skipped; more than 1% malformed fails the run (layout drift, like the May 2024 reorder).
   The job runs in the web process (`server/_core/index.ts:438` starts the scheduler there), next
   to the site and the Vapi and SMS webhooks, and unzipped chunks are large (391.7 MB current,
   876.3 MB for 2015-2019, 859.3 MB for 2020-2024). So the parser feeds fflate one network chunk
   at a time and yields to the event loop after each inflated slice
   (`await new Promise((r) => setImmediate(r))`), or it runs in a `worker_threads` worker. It
   never parses a chunk in one synchronous pass.
6. **Receipt:** `cron_log` details carry chunks fetched or skipped, rows read, rows malformed,
   communications kept by signal, and products upserted. These numbers are what §9's acceptance
   compares against.

## 7 · The read path and the panel block

### 7.1 Procedure
`vehicleData.warrantyExtensions` (admin-only, same `vehicleInput` as `recalls`) returns
`{ ok: true, matches, freshness }` or `{ ok: false, reason }`. Each match carries the communication
fields, its `signal`, and how the vehicle matched (`exact` model, or `related` model, §8).

### 7.2 Wording (Q-46 rules apply: information, not a diagnosis or a promise)
- Header: **"Manufacturer warranty programs (may apply)"**.
- Each item: manufacturer date, the document id, the summary (collapsed after 2 lines), and a tag:
  "NHTSA: warranty program" for `nhtsa_type`, or "found by summary wording" for `summary_text`.
  A `related` model match also says which model name NHTSA used ("listed for SILVERADO 1500").
- Footer, always shown: "Eligibility depends on VIN, mileage, in-service date and sometimes state.
  Confirm with a dealer before quoting this repair."
- Never the words "covered", "free" or "the manufacturer will pay". The link goes to NHTSA's lookup
  page (`https://www.nhtsa.gov/recalls`, phase 1's constant), not to a guessed PDF URL. The
  document URL pattern (`static.nhtsa.gov/odi/tsbs/<year>/MC-<id>-<seq>.pdf`) has a sequence suffix
  this design cannot derive.

### 7.3 Empty vs error
| State | Shows |
|---|---|
| Table missing, read failed, or flag off | "Manufacturer programs unavailable — NOT the same as none on file", with the reason |
| Last successful ingest older than 3 days | the matches, plus "NHTSA list last updated <date>, may be out of date" |
| Fresh ingest, zero matches | "None listed by NHTSA for this year/make/model", with the update date |

Freshness comes from the latest `cron_log` row of `nhtsa-warranty-ingest` with status `completed`,
read the way `cron/jobs/cronSkipWatchdog.ts` reads `cron_log`.

> **Corrected in phase 2b (2026-10-01).** Freshness is read from the ingest's own state row
> (`lastSuccessAt` in `shop_settings` key `nhtsa_warranty_chunk_state`), not `cron_log`: a flag-off
> or missing-migration skip is also logged there as `completed` (phase 2a review). "Flag off" is
> not its own unavailable state either: per §11, turning the flag off keeps the last ingest on
> screen with the staleness note after 3 days. An ingest that has never finished a run shows
> "unavailable". Code: `server/services/nhtsaWarrantyRead.ts`.

Once the ingest has run, the same freshness reading can become a row on Intelligence HQ's Data
freshness card (`client/src/pages/admin/today/freshnessRows.ts`, Q-23 phase 9); that is a
follow-up, not part of phase 2.

> **Built in phase 3 (2026-10-01).** The row is `nhtsaWarrantyRow` in that file, read through
> `vehicleData.warrantyIngestFreshness` (the same `lastSuccessAt` and 3-day rule, plus the flag
> read from its row so a flag-table failure shows "unknown", not "off").

## 8 · Matching shop names to NHTSA names (and phase 1's carry-overs)

Work orders store whatever the booking text held: `workOrderAutomation.ts:139-150` takes the
second word as make, so "Chevy", "F150" and "Land" (for Land Rover) are common. Phase 1's live
probes showed NHTSA's API answering HTTP 400 for exactly those (phase 1 merge note, finding 1).

1. **Normalize** both sides: uppercase, hyphens removed, runs of spaces collapsed to one
   (`F-150` and `F150` both become `F150`; `SILVERADO 1500` stays two words).
2. **Make aliases**, one small table in code, shared with `recallsByVehicle` and
   `complaintsByVehicle`: `CHEVY→CHEVROLET`, `VW→VOLKSWAGEN`, `MERCEDES` / `MERCEDES BENZ` → `MERCEDESBENZ` (uppercasing already folds
   `MERCEDES-BENz`), `LAND`+model `ROVER ...` → `LAND ROVER`. This is
   the fix for phase 1's 400s on `chevy silverado 2015` and `land rover range rover 2016`.
3. **Model:** an `exact` match on the normalized name; otherwise a `related` match when one name is
   a whole-word prefix of the other (`SILVERADO` ↔ `SILVERADO 1500`). `related` matches are labelled, never merged silently.
4. **Year:** exact. `9999` rows are shown under "model year not stated by the manufacturer".

Phase 1's other carry-overs (the complaints timeout; the friendly message for a 400 with an empty
body; the six missing tests: dd/mm order, deaths-only, errors not cached, `count` vs row count,
park-outside badge, complaints `{ok:false}`) go in phase 2b's PR, because they are in the same two
files.

## 9 · Phases and acceptance

| Phase | Ships | Acceptance (red on `main` first where a test is new) |
|---|---|---|
| **2a** | migration file, `schema.ts` tables, ingest job + flag, parser, classifier | (1) A fixture TSV with one typed WPE row, one GM "Service Campaign" Special Coverage row, one "Warranty Newsletter" row, one VW "enrollment period has been extended" row and one malformed row. The classifier keeps the first three with the right `signal` and drops the VW row; the malformed row is counted. (2) A mutant that drops either signal turns a test red. (3) The chunk-name probe fails the run when every candidate 404s. (4) An upsert run twice yields the same row count. (5) A Node run on the real current chunk, recorded in the PR (not a test): wall time, peak RSS, and the p99 and max event-loop delay from `perf_hooks.monitorEventLoopDelay` during the parse. The flag stays off until the max delay is under 250 ms |
| **2b** | the procedure, the panel block, the make aliases, phase 1's carry-overs | Render tests for the three §7.3 states, the `related` label and the always-on footer. A forbidden-wording test ("covered", "free", "will pay"). An alias test: `Chevy`/`Silverado`/2015 resolves to `CHEVROLET`. The six missing phase-1 tests |
| **Operator** | apply the migration, arm `nhtsa_warranty_ingest`, read the first run's `cron_log` receipt, open one work order for a car with a known program (e.g. a 2016-2018 Hyundai Santa Fe with the 3.3L) | First run: every chunk fetched, malformed rows under 1%, kept communications within ±10% of this note's 2,550 for 2015-2026 |

## 10 · Alternatives rejected

| Option | Why not |
|---|---|
| Live `manufacturerCommunications` API per work order | Not public: 403 "Missing Authentication Token" |
| The CSV file instead of the TSV | No `Communication Type`; the text rule alone misses 58% of typed rows |
| Type field only | Zero coverage before mid-2024, and misses GM Special Coverage |
| Storing all 5.3 M rows (every TSB) | Every non-warranty TSB is a different product question (repair procedures). Out of scope; revisit only with a named consumer |
| A third-party TSB feed (Alldata, Mitchell, Identifix) | Paid, and an account is an operator decision. NHTSA's file is free and authoritative for what manufacturers filed |
| Running the ingest on the worker | No DB client by design (`apps/worker/AGENTS.md`); it would need a new write endpoint for bulk rows |

## 11 · Kill switch and rollback

- **Kill:** turn the flag off. The job stops at its first line; the panel keeps showing the last
  ingest, with the staleness warning after 3 days.
- **Rollback 2b:** revert the PR. The panel loses the block, and phase 1's recalls and complaints
  are untouched.
- **Rollback 2a:** revert the PR. The tables stay, harmless and unread. Dropping them is a
  destructive DDL, so it is the operator's call, never the loop's.

## 12 · Questions for the operator

1. Is the shop willing to quote around a manufacturer program, for example by sending the customer
   to the dealer for a covered part? That decides whether "may apply" belongs on the work order the
   tech sees, or only in the advisor's drawer. This design assumes the drawer only.
2. Daily in the 09:30 ET tier, or weekly only (e.g. Sunday, when the shop is closed)? Daily costs
   about 12 MB of download and one stream parse of 392 MB during shop hours; weekly makes a new
   extension up to 7 days late. This design defaults to daily, and phase 2a's measured parse cost
   decides whether that holds.

## 13 · What this note does not prove

- **Not measured:** Node's parse time and peak memory on the 392 MB chunk; the four pre-2015 chunks.
- **Not measured:** how many of Nick's real work orders match any program. That needs a production
  read of `work_orders` (year/make/model only), an INTERACTIVE item.
- The precision figures in §4 are hand-read samples of 25 and 15 rows, not a measured rate over the
  corpus.
