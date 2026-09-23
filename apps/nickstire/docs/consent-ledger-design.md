# Consent ledger - design note (Q-43)

Status: **PROPOSED - design only, nothing built.** Written 2026-09-23 against
`origin/main` `f04e4d0` (queue item Q-43 in
`docs/research/2026-09-23-estate-master-architecture.md` 14.4; context in 10.3,
11.2 move 1 and 8 item 4). Consent, opt-out and quiet hours are protected core
(`PROTECTED-CORE.md`). Every build step below therefore needs targeted tests,
a compatibility review and rollback notes, and every production write (the DDL,
the backfill, the flag flips) is an operator action.

Not legal advice. **[COUNSEL]** marks a question for a lawyer. Legal claims cite
the rule text as read on 2026-09-23 from the eCFR point-in-time copy of
47 CFR 64.1200 dated 2026-09-01, unless another source is named.

---

## 0. The answer in five lines

1. **Build one append-only table, `contact_consent_events`.** Consent and
   revocation become events, and the current state is derived from them. It is
   not a "one row per phone" table: a row that gets overwritten destroys the
   evidence the ledger exists to keep (section 4.1 argues this).
2. **Keep one read path.** Section 4.4: the ledger becomes the FIFTH source of
   `loadSuppressionIndex()` (`server/sms.ts:147`). The same load returns grants
   by scope. One pure function, `decideContact(index, phone10, purpose, now)`,
   answers every lane. `getSmsOptInIndex()` stops querying and becomes a view,
   so the repo goes from two consent reads to one.
3. **Revocation from any channel writes the same event.** This covers inbound
   text (keyword or plain English), anything the caller says on a Vapi call,
   email one-click unsubscribes, and admin entries. A plain-English detector
   **revokes** when it is sure. When it is unsure it **holds**: the number is
   suppressed right away, and a human reviews it the same business day.
4. **Every automated send records the consent basis that allowed it.** That
   is the event id plus the scope, written as an `audit_log` row
   (`consent.decision`), with no DDL on any existing table.
5. **Rollout is off, then shadow, then enforcing suppression, then enforcing
   grants lane by lane.** Only the last step can cost revenue, and it needs
   the counsel answers in section 10 first.

## 1. Premise check (what already exists)

Searched for `consent`, `opt_out`, `suppress`, `revoc`, `unsubscrib` across
`apps/nickstire` and read `docs/UPSTREAMS.md`. No consent ledger in the Q-43
sense exists: nothing covers scopes, disclosure versions, AI-voice consent,
cross-channel revocation, or the basis for each send. **Parts of one do exist,
and this design builds on them instead of beside them:**

| Piece | Where | What it is | Gap |
|---|---|---|---|
| Suppression index, 4 sources | `server/sms.ts:147-243` (`loadSuppressionIndex` -> `ensureOptOutCache`) | Union of `customers.smsOptOut`, `sms_preferences.opted_out`, inbound bodies that are exactly an opt-out keyword (`:203-210`), and carrier-block notices. Honest failure: `ok:false` or `stale`, never an empty set (`:74-76`) | Keyword-exact only. No voice or email source. Suppression only: it says nothing about who agreed to what |
| Opt-in "ledger" | `server/services/complianceLog.ts:82-108` (`logSmsOptIn` -> `audit_log` action `sms.opt_in`) and the reader `getSmsOptInIndex` (`:256-288`) | Consent rows keyed by phone, read at `sendSms` for `customer_marketing` in SHADOW (`server/sms.ts:1911-1933`; ROS-095 in `docs/ISSUE-REGISTRY.md:133`) | No scope, no disclosure text or version, no revocation. The writers record **"implicit consent"** on every lead and booking submission (`server/routers/lead.ts:183-192`, `server/routers/booking.ts:305-314`). See finding F1 |
| Opt-out audit rows | `complianceLog.ts:116-132` (`sms.opt_out`) | Written by the live inbound path (`server/services/smsOrchestrator.ts:941-968`) | Keyword path only |
| Cross-lane gate test | `server/cron/jobs/outboundLanes.suppression.test.ts:314-347` | Fails if a dialing lane skips `loadSuppressionIndex()` | Does not check purpose or grants |
| Prior deferral | `docs/plans/REVENUE-AUTOPILOT-2-AUDIT.md:60` | The purpose-scoped ledger was **deferred** on 2026-07-29 until a trigger fired: "a real purpose-specific opt-out request, a TCPA complaint/inquiry, or a channel expansion" | **The channel-expansion trigger has fired.** AI-voice outbound is live (`FEATURE_VOICE_RECOVERY=1`, `FEATURE_CONFIRMATION_CALLS=1`, `truth_os.md:22-23`), and the recovery lane placed its first connected calls after the 2026-09-22 dial fix (`docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md:387`) |

The premise holds, so this is not a skip. The design **extends**
`loadSuppressionIndex`, `complianceLog` and the lane gate test. It adds no
parallel system.

## 2. Current state, traced (file:line for each claim)

### 2.1 Inbound text

- **Keyword list.** `shared/smsOptOutKeywords.ts:25-36` is exact-match on the
  whole trimmed body. Its own header (`:19-23`) says plain-English opt-outs
  are **not covered** and "stay a human-review question". Today nothing sends
  them to a human.
- **Live parser.** `server/services/smsResponseParser.ts:68` is
  prefix-anchored, with `stop` guarded against `stop by/in/over/at/off`, plus
  `stopall | unsubscribe | opt out | revoke | end | quit | remove me`. It
  **excludes a bare `CANCEL` on purpose** (`:51-55`): for a repair shop,
  "cancel" usually means cancel the appointment.
- **Where a live opt-out lands.** The orchestrator sets
  `customers.smsOptOut=1`, calls `markPhoneOptedOut`, and writes `sms.opt_out`
  (`smsOrchestrator.ts:941-968`).
- **Dead code.** `handleInboundSms` (`server/sms.ts:1124`) is **not the live
  path**: its own header says it has zero callers (`:1113-1123`). It holds the
  only START handler and the only `start_keyword` opt-in writer
  (`:1158-1168`). See F2.
- **Plain-English replies.** The fallback classifier matches
  `stop|unsubscribe|opt out|cancel|quit|end` anywhere in the text
  (`server/services/classifiers.ts:238`), but only to label intent. Nothing
  suppresses on it.

### 2.2 Voice (Vapi)

- **Mid-call transcript chunks are dropped in production**
  (`server/routes/webhooks/vapi.ts:1082-1088`).
- **End of call.** The `end-of-call-report` event is acked, then processed in
  the background (`:1061-1080` -> `processCallEndReport`, `:390`). The full
  transcript is read at `:416`. The **customer turns only** are extracted from
  the role-tagged `artifact.messages` and saved to
  `vapi_call_logs.metadata.customerSpeech` (`:543-595`, via
  `services/customerTurns.ts`).
- **Daily backstop.** `services/vapiCallArchive.ts:1-19,131` stores
  transcripts before Vapi's 14-day purge.
- **Nothing reads either one for a revocation.** The structured-data plan has
  no do-not-contact field (`services/vapi.ts:795-830`; the nearest field is
  `followUpNeeded` at `:822`). **A caller who says "stop calling me" reaches
  no text lane and no voice lane today.** See F3.
- **Dialing lanes all consume the index and fail closed on `ok:false` or
  `stale`.** Recovery (`cron/jobs/voiceRecovery.ts:186-196`), confirmation
  calls (`cron/jobs/confirmationCalls.ts:150`), follow-up cadence
  (`cron/jobs/followupCadence.ts:186`), and the operator button
  `makeFollowUpCall` (`routers/vapi.ts:1287-1300`). Enforced by
  `outboundLanes.suppression.test.ts:323-347`.
- **Call windows are in shop time (ET).**

  | Lane | Window (ET) | Where |
  |---|---|---|
  | Recovery | 10:00-17:00 | `voiceRecovery.ts:74-82` |
  | Confirmation | 15:00-18:00 | `confirmationCalls.ts:51-58` |
  | Follow-up cadence | 09:00-18:00 | `followupCadence.ts:91-94` |

- **Label mismatch.** `truth_os.md:24` labels `FEATURE_FOLLOWUP_CADENCE` as
  "SMS". The file dials Vapi (it is in the gate's dialing-lane list,
  `outboundLanes.suppression.test.ts:326`). Fix the label when this lands.

### 2.3 Email

- `services/emailCampaigns.ts:190-208` consumes the same index and fails
  closed (operator's cross-channel decision of 2026-09-16, recorded at
  `:174-179`).
- The unsubscribe is a `mailto:` link (`:288`) sent in both headers,
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (`:305-309`). RFC 8058 one-click needs an **HTTPS** URI in
  `List-Unsubscribe`. Paired with a `mailto:` only, the Post header does
  nothing.
- The code's own note says an email unsubscribe "is recorded NOWHERE
  machine-readable" (`:184-188`).
- The footer asks people to "reply STOP to this email" (`:293`), but mail is
  sent `from` `noreply@` (`:301`) with no Reply-To. See F4.

### 2.4 Web-form consent

- Booking and lead submissions call `logSmsOptIn` with the comment "implicit
  consent via booking/lead form" (`booking.ts:305`, `lead.ts:183`).
- A client grep finds **no marketing-consent checkbox and no stored
  disclosure text**. The consent language that exists is copy such as "Reply
  STOP to opt out" (`client/src/components/conversion/TextMeQuote.tsx:146,218`)
  and the Terms page (`client/src/pages/Terms.tsx:84-100`).
- *Strong inference, not verified in a browser:* no public form currently
  captures prior express **written** consent as 64.1200(f)(9) defines it.

### 2.5 The send chokepoint

`sendSms` (`server/sms.ts:1727`) resolves `messageClass`, which defaults to
`customer_marketing` (`:1739`), then runs these gates in order:

1. Opt-out and carrier-block gate, fail closed (`:1843-1882`).
2. Marketing consent gate, in SHADOW unless `SMS_CONSENT_GATE=enforce`
   (`:1911-1933`).
3. Quiet hours, 8:00-20:00 **ET** (`:324-331`, applied at `:1939`).
   Confirmations and internal messages bypass them.

Three SMS lanes also keep a local `customers.smsOptOut` pre-filter
(`cron/jobs/declinedWorkRecovery.ts:315`, `staleLeadFollowup.ts:66`,
`missedCallRecovery.ts:125`). That is harmless, because `sendSms` re-checks,
but it is a second definition to retire.

### 2.6 Findings this trace surfaced (not fixed here - design note only)

- **F1 - The shadow marketing gate would count implicit consent as marketing
  consent.** The shadow gate counts every `sms.opt_in` row as marketing
  consent. Most of those rows come from a booking or lead form with no
  disclosure. Arming `SMS_CONSENT_GATE=enforce` against those rows would treat
  a booking as prior express written consent, which (f)(9) does not allow
  (section 3). The backfill in section 7 reclassifies them as
  `sms_informational`.
- **F2 - Nothing can re-subscribe a number.** No START or UNSTOP handler is
  live (2.1), and `markPhoneOptedIn` (`server/sms.ts:298`) has no callers.
  Separately, the message-log source makes a keyword STOP **permanent**
  (`:90`, `:203-210`). This fails in the safe direction. It does mean a
  customer cannot re-subscribe by text, while the compliance comments
  (`complianceLog.ts:248`) say they can.
- **F3 - A spoken "stop calling" is never honoured.** Nothing turns it into a
  suppression, on any lane. With AI-voice lanes live, this is the
  highest-exposure gap in this note.
- **F4 - Email unsubscribes are not machine-readable.** The one-click header
  is inert, and "reply STOP" goes to a no-reply sender.
- **F5 - A bare `CANCEL` counts as revocation.** (a)(10) names "cancel"
  among the words that revoke consent *per se* when sent in reply to a text.
  The live parser does not treat it as an opt-out. The suppression index
  still catches it, because `CANCEL` is in the keyword list (`sms.ts:208`), so
  the number stops getting texts within the 5-minute cache TTL. What is
  missing is the compliance row and the confirmation text. **[COUNSEL]**
  whether "cancel" sent in reply to an appointment text is a revocation.
  Section 5.1 treats it as one, which is the rule's plain text.

## 3. The rules this must satisfy

Where the source is 64.1200, it is 47 CFR 64.1200 as of 2026-09-01; the
other sources are named in the table.

| Rule | Requirement | Binding here | Source |
|---|---|---|---|
| Revocation, any reasonable means | A revocation made "by using any reasonable method" is valid. The words stop/quit/end/revoke/opt out/cancel/unsubscribe sent in reply to a text revoke *per se*. **Other words must be treated as a revocation "if a reasonable person would understand those words to have conveyed a request to revoke consent"**. It must be honoured "within a reasonable time not to exceed ten business days", and the caller may not designate an exclusive means | Plain English is a legal requirement, not a nicety. This is what 5.1 implements | 64.1200(a)(10) |
| Other channels | A voicemail or an email to the business "creates a rebuttable presumption" of revocation | Emails to `unsubscribe@` or any shop address, and spoken requests | 64.1200(a)(11) |
| Confirmation text | One text confirming the revocation, with no marketing, is allowed. Within 5 minutes it is presumed covered | The reply the SMS path already sends | 64.1200(a)(12) |
| Revoke-all scope | A revocation for one kind of message also revokes unrelated robocalls and robotexts. **Effective date extended to 2027-01-31** | The shop already runs this posture (STOP suppresses every lane; operator decision 2026-09-16). The design keeps it, so this date changes nothing here | FCC DA 26-12 (released 2026-01-06) |
| Informational calls and texts to cell phones | Autodialed or artificial-voice calls need "prior express consent" | `confirmationCalls`; transactional texts | 64.1200(a)(1)(iii) |
| Telemarketing | Autodialed or artificial-voice telemarketing to a cell phone needs **prior express written consent**. To a residential line with an artificial voice, the same | Recovery and follow-up calls if counsel classifies them as telemarketing; marketing texts | 64.1200(a)(2), (a)(3) |
| What written consent is | A signed agreement (e-signatures count). A clear and conspicuous disclosure that it authorizes telemarketing by autodialer or artificial voice, and that signing is **not a condition of purchase**. It names the phone number | The disclosure registry and checkbox in 5.4 | 64.1200(f)(9) |
| AI voice counts as artificial voice | AI-generated voices are "artificial" under the TCPA. Adopted 2024-02-02, released 2024-02-08, effective immediately | Every Vapi outbound lane | FCC 24-17 Declaratory Ruling |
| Call content | State the business name at the start and give a callback number. Telemarketing calls must offer an automated opt-out | Q-45 builds this; its opt-out writes to this ledger | 64.1200(b)(1)-(3) |
| Quiet hours | No telephone solicitation before 8 a.m. or after 9 p.m. "local time at the called party's location" | Every window in 2.2 and 2.5 is ET-only | 64.1200(c)(1) |
| National DNC | No solicitations to registered numbers, unless there is a signed written agreement or an established business relationship (EBR: a purchase within 18 months, or an inquiry within 3 months) | Marketing without written consent | 64.1200(c)(2), (c)(2)(ii), (f)(5) |
| Company do-not-call list | A **written policy**, trained staff, and requests recorded "at the time the request is made", honoured within 10 business days and **kept for 5 years** | This note plus the ledger are that policy and list. Retention floor in section 9 | 64.1200(d)(1)-(3), (d)(6) |
| Liability | $500 per violation, up to 3x if willful or knowing | Why a known-but-ignored revocation matters | 47 U.S.C. 227(b)(3) |

## 4. Data design

### 4.1 Why events, not one row per phone

The queue item says "one row per phone". An overwritable row fails three
requirements:

1. It cannot show *when* consent was given if a later revocation overwrote it.
2. It cannot order a STOP against a later START (F2).
3. It turns a late webhook retry into a silent overwrite.

The ledger is therefore append-only. "One row per phone" survives as a
**derived view**:

```
latest(subject, scope) = last event by (occurred_at, id)
```

That gives each phone a `captured_at` (the grant's `occurred_at`) and a
`revoked_at` (the later revoke's `occurred_at`).

### 4.2 Table `contact_consent_events`

Hand-applied TiDB DDL. Shape only; the SQL is written in the build PR.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT AUTO_INCREMENT PK` | |
| `subject_type` | `VARCHAR(8) NOT NULL` | `phone` or `email` |
| `subject_key` | `VARCHAR(255) NOT NULL` | Last 10 digits of the phone, or the lowercased email. Same key as the index (`sms.ts:167-170`) |
| `customer_key` | `VARCHAR(64) NULL` | HMAC pseudonymous key from master-architecture 8 item 2, filled when that lands. Never sent to statenour with `subject_key` |
| `scope` | `VARCHAR(32) NOT NULL` | `sms_conversational`, `sms_informational`, `sms_marketing`, `voice_ai_informational`, `voice_ai_marketing`, `email_marketing`, `all` |
| `action` | `VARCHAR(16) NOT NULL` | `grant`, `revoke`, `hold`, `release` |
| `source` | `VARCHAR(48) NOT NULL` | e.g. `booking_form`, `lead_form`, `sms_keyword`, `sms_plain_english`, `vapi_transcript`, `vapi_structured`, `vapi_optout_tool` (Q-45), `email_one_click`, `admin`, `backfill:<origin>` |
| `method` | `VARCHAR(32) NOT NULL` | `web_checkbox`, `web_submit_implicit`, `sms_reply`, `voice_call`, `email_link`, `email_message`, `in_person`, `paper_form` |
| `disclosure_id` | `VARCHAR(64) NULL` | Key into the repo's disclosure registry (5.4). Required for a `sms_marketing` or `voice_ai_marketing` grant |
| `disclosure_version` | `VARCHAR(16) NULL` | |
| `disclosure_sha256` | `CHAR(64) NULL` | Hash of the exact rendered text, recomputed server-side |
| `evidence_ref` | `VARCHAR(191) NOT NULL` | e.g. `sms_messages:<id>`, `vapi:<callId>`, `booking:<id>`, `admin:<userId>:<uuid>`. NOT NULL so the unique key below works (MySQL unique keys ignore NULLs) |
| `evidence_excerpt` | `VARCHAR(160) NULL` | **The matched phrase only.** Never a transcript or a full message body (PROTECTED-CORE rule 5) |
| `detector_version` | `VARCHAR(16) NULL` | For plain-English and voice events |
| `ip_address` | `VARCHAR(45) NULL` | Web grants |
| `user_agent` | `VARCHAR(300) NULL` | Web grants |
| `actor` | `VARCHAR(100) NOT NULL` | `system:<writer>` or the admin's email |
| `occurred_at` | `DATETIME(3) NOT NULL` | When the *customer* acted. Starts the 10-business-day clock |
| `occurred_at_estimated` | `TINYINT NOT NULL DEFAULT 0` | 1 for backfilled rows whose original time is unknown |
| `recorded_at` | `TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` | |
| `review_status` | `VARCHAR(16) NULL` | Holds only: `pending`, then `revoked` or `cleared` |
| `reviewed_by` | `VARCHAR(100) NULL` | |
| `reviewed_at` | `DATETIME NULL` | |

Keys and indexes:

- `UNIQUE (source, evidence_ref, scope, action)`. Idempotency: a Vapi call
  seen by both the webhook and the archive backstop, or a re-run of the
  backfill, writes once. Writers use `INSERT IGNORE`; TiDB has no `ON
  CONFLICT`.
- `INDEX (subject_type, subject_key, occurred_at)`.
- `INDEX (action, review_status)`.

The index build reads the whole table, as it already does for its four
sources. Volume is roughly one row per customer plus revocations, which is
thousands of rows, not millions.

### 4.3 Deriving state (a pure function, `deriveContactState(events)`)

1. Sort by `(occurred_at, id)`.
2. **Any `revoke` suppresses every automated scope**, whatever its own
   `scope`. The original scope is kept as evidence. This is the shop's
   existing revoke-all posture, and it matches the 2027 rule early.
3. **A `hold` suppresses every automated scope** until a later `release` (the
   reviewer cleared it) or `revoke` (the reviewer confirmed it).
4. **A `grant` after a `revoke` restores only its own scope, and only when
   the customer started it:** `sms_keyword` START, a new checkbox submission,
   or `in_person` / `paper_form` with an `evidence_ref`. An admin grant with
   no evidence is rejected at write time, not at read time.
5. **On a tie at the same instant, revoke wins over grant.**

### 4.4 The one read path

`ensureOptOutCache()` (`server/sms.ts:151`) gains **source 5**: every phone
whose derived state is revoked or held joins `phones`. **No lane changes to
honour ledger suppressions.** Every lane already consults `phones`, and the
gate test already proves that.

The same load also returns `grants: Map<phone10, Set<Scope>>` on the `ok`
branch of `OptOutIndex` (`sms.ts:74-76`). `getSmsOptInIndex()`
(`complianceLog.ts:256`) is rewritten as a view over that map, and its own
`audit_log` query is deleted. The result is one load and one cache: the rule
"never a second check" is met by removing the second check that exists today.

`decideContact(index, phone10, purpose, now)` is a new pure export beside
`loadSuppressionIndex`. It returns:

```
{ allow, basis: { scope, eventId } | null, wouldBlockReason, windowOk }
```

The existing callers call it with the index they already loaded, so it adds
no database read.

**Failure contract** (same as today's index, `sms.ts:61-73`). If the ledger
table is missing (`isMissingTableError`, as in `vapiCallArchive.ts:164`):

| Mode | What happens |
|---|---|
| `off` / `shadow` | Source 5 is skipped with a `log.error`, and the index stays `ok:true`. The four existing sources still stand |
| enforcing | The whole index is `ok:false`, so every lane refuses |

A ledger that exists but cannot be read is `ok:false` in every mode.

### 4.5 Recording the basis for each send (master 8 item 4)

Each automated send that passes `decideContact` writes an `audit_log` row
through `complianceLog`:

- `action = consent.decision`, `entity_type = contact_attempt`,
  `entity_id = sms_messages:<id> | vapi:<callId>`.
- `changes = {lane, purpose, scope, eventId, mode, verdict}`.

In shadow mode the same row carries `verdict: would_block` and the reason.
This reuses `audit_log` (its `idx_audit_entity` index leads with
`entity_type`, per `complianceLog.ts:252-254`) and adds no column to a hot
table. Volume is tens of rows a day. A dedicated column on `sms_messages` can
come later, once someone needs to query it.

## 5. Write paths

### 5.1 Inbound text, including plain English

A pure, versioned detector in `shared/revocationDetector.ts` returns
`{verdict: 'revoke' | 'hold' | 'none', matched, version}`. It runs where the
live path already parses the text (`smsOrchestrator.ts:941`), after
`parseSmsResponse` and **only when that did not already unsubscribe**.

**Normalising the text.** Lowercase it, fold curly apostrophes, collapse
spaces, and strip one trailing punctuation mark.

**`revoke` (suppress now and record the event):**

- *Per se.* The whole body is one of the (a)(10) words (stop, quit, end,
  revoke, opt out, cancel, unsubscribe), or one of the existing
  `SMS_OPT_OUT_KEYWORDS`. This includes a bare **`cancel`** (F5).
  - When the customer has an active booking, the orchestrator still cancels
    the booking as it does today.
  - The **one** confirmation text, sent within 5 minutes under (a)(12),
    confirms both actions and states how to opt back in.
  - **[COUNSEL]** confirms this reading.
- *High-confidence phrases anywhere in the message.* Examples:

  | Phrase family | Example |
  |---|---|
  | stop contacting | "stop (texting \| messaging \| calling \| contacting) (me \| us)" |
  | do not contact | "(do not \| don't \| dont) (text \| call \| message \| contact) (me \| this number)" |
  | take me off | "take (me \| my number) off", "remove (me \| my number)" |
  | no more messages | "no more (texts \| messages \| calls)", "stop sending" |
  | leave me alone | "leave me alone", "lose my number" |
  | unsubscribe | "unsubscribe me" |
  | wrong number | "wrong number" |

  "Wrong number" revokes **that number**. Whatever consent is on file belonged
  to someone else, which is the reassigned-number case.

**`hold` (suppress now, same-day human review):**

- A bare "stop" or "end" inside a longer message that does not match the
  exemptions below.
- "Not interested", "no thanks", "quit it".
- "Who is this", "is this spam", "reported", "blocked".
- Hostile or profane replies to an automated message.

**`none` (explicit exclusions, each with a test):**

- "stop by", "stop in", "stop over", "stop at", "stop off" (the existing
  guard at `smsResponseParser.ts:68`).
- "end of", "end up".
- A spam footer: "reply stop to ...".
- "Don't cancel", or "cancel" inside a sentence about an appointment.

**Why suppress on ambiguity (the error-cost argument):**

| Error | What it costs | How often it recurs |
|---|---|---|
| **False negative** (a revocation missed) | $500 per later message, up to $1,500 if willful (227(b)(3)). The shop's own log would show it received the words, which is the willfulness evidence. Cadence and drip lanes send several touches, so one miss becomes several violations | Every automated send until someone notices |
| **False positive** (a customer wrongly held) | That customer gets no automated messages until a reviewer clears the hold, normally the same day. Conversational replies from staff go through the reviewer too. No revenue is lost that same-day release cannot recover | Bounded by the review time |

The costs are strongly asymmetric, so an ambiguous message holds. The
detector is conservative, not clever: a phrase list with fixtures, no LLM. It must be auditable and deterministic, and the
reasonable-person test is applied by the human reviewing the hold, not by a
model.

**Measuring the error rates** (base-rate-check).

1. Before enforcing, replay the detector read-only over every historical
   inbound body. Report `revoke / hold / none` counts against **all** inbound
   messages.
2. Report the reviewer's `cleared / revoked` split on holds. The cleared share
   is the measured false-positive rate.

**Where a hold is reviewed.** The review item goes through the existing
opportunity queue. `captureComplaintOpportunity`
(`services/opportunityQueue.ts:1517`) is already called on inbound texts
(`routes/webhooks/smsGateway.ts:355-358`). Before adding a new kind, check the
width of its kind or status column (nickstire-tidb-ddl).

**Deadlines for a hold.**

| When | What happens |
|---|---|
| Same business day | Target for review |
| 24 hours | Escalates |
| 5 business days | Pages the owner. This is half the legal ceiling |

Throughout, the number stays suppressed, so a late review is never a
violation.

**Fix START (F2) in the same PR.** The live parser gains START / UNSTOP /
YES-to-resubscribe handling that writes `grant` events with
`source = sms_keyword`. The dead `handleInboundSms` is then deleted
(prior-art: do not revive it).

### 5.2 Vapi call end, inbound and outbound

- **Primary.** A new independent `try` block in `processCallEndReport`, next
  to the customer-speech block (`vapi.ts:543-595`). It runs the **same
  detector over the customer turns only**, the ones
  `extractCustomerTurnsFromMessages` already produces. This is deliberate.
  The assistant's own lines (for example Q-45's "say stop to opt out") must
  never read as the customer revoking.
  - `evidence_ref = vapi:<callId>`.
  - `evidence_excerpt` = the matched phrase only.
  - "Stop calling" on any call suppresses **every** lane, including text.
- **Second signal.** Add `doNotContactRequested: boolean` to the
  `structuredDataPlan` schema (`services/vapi.ts:795+`, beside
  `followUpNeeded`).

  | Model says | Detector says | Result |
  |---|---|---|
  | true | none | `hold` for review (`source = vapi_structured`) |
  | - | revoke or hold | the detector's verdict stands |

  The model can only add suppression. It can never clear it.
- **Backstop.** The daily archive pass (`vapiCallArchive.ts:131`) runs the
  detector on newly archived transcripts. This covers calls whose webhook
  processing failed. The unique key makes the double path idempotent.
- **In-call opt-out (Q-45).** When Q-45 adds an automated in-call opt-out,
  that tool writes `source = vapi_optout_tool` with no review, because it is
  per se.
- **Timing.** The webhook path acts within seconds of hang-up. The backstop
  acts within about 24 hours. Both are well inside 10 business days, and both
  run before the next lane can dial: every dialing lane re-reads the index
  within 5 minutes.

### 5.3 Email

1. **Fix one-click.** Put an **HTTPS** one-click URI in `List-Unsubscribe`,
   next to the mailto (`emailCampaigns.ts:305-309`). It is
   `https://nickstire.org/api/email/unsubscribe?t=<token>`, where the token is
   an HMAC-signed `{email, campaign, issuedAt}`.
   - A `POST` writes `revoke` with `subject_type = email`,
     `source = email_one_click`.
   - A `GET` renders a confirmation page. Link scanners must never
     unsubscribe anyone by fetching the URL.
   - A forged or expired token gets a 400 and writes nothing.
2. **Link to the phone.** If exactly one customer row links the email to a
   phone, also write a phone-subject `revoke` (the operator's cross-channel
   policy). If the link is ambiguous, write a `hold`.
3. **Change the "reply STOP" copy** or add a monitored Reply-To. Until a
   mailbox reader exists, mail to `unsubscribe@` and replies are entered
   through the admin path (5.5) with `method = email_message`, under the
   (a)(11) presumption.

### 5.4 Web forms and the disclosure registry

- **`shared/consentDisclosures.ts`** (new, versioned, code-reviewed) holds
  `{id, version, scopes, text}`.
  - Forms render the text **from the registry** and submit `id@version`.
  - The server looks the text up again, hashes it, and refuses an unknown
    version.
  - Changing the wording means a new version, never an edit in place.
- **Marketing checkbox** (optional, **unchecked by default**, separate from
  the submit button). Its text states:
  - the shop may send automated marketing texts and AI-voice calls to the
    number given;
  - consent is **not a condition of purchase** (f)(9)(i)(B);
  - how to revoke, and that message and data rates apply.

  A ticked box writes `grant` for `sms_marketing` and `voice_ai_marketing`,
  with `method = web_checkbox`, the disclosure fields, IP and user agent.
  **[COUNSEL]** approves the exact text and whether a checkbox plus submit
  counts as an e-signature under E-SIGN.
- **A plain booking or lead submission** keeps working and writes `grant` for
  `sms_informational` and `voice_ai_informational` only, with
  `method = web_submit_implicit`. It is **never** marketing (F1).
  **[COUNSEL]** whether giving a number on a booking form is prior express
  consent for AI-voice confirmation calls.

### 5.5 Admin

A compliance tab already exists (`client/src/pages/admin/settings/ComplianceSection.tsx`).
It gains three actions:

- **Record revocation.** One tap, a reason is required, and it takes effect
  immediately.
- **Record written consent from a paper form.** `evidence_ref` is required,
  pointing to the stored scan.
- **Resolve hold.** Revoke or clear, recording the reviewer and a timestamp.

Admin grants without evidence are refused at the tRPC layer. All actions use
the in-DOM two-tap confirm, never `window.confirm`
(nickstire-ios-pwa-primitives).

## 6. Consent each outbound lane needs

Purpose is set **by the lane, in code**. It is never inferred from the
message text.

| Lane | Purpose (proposed) | Consent needed | Basis today | Decision owner |
|---|---|---|---|---|
| `sendSms` `customer_followup` (replying to the customer's own inbound) | `sms_conversational` | Not revoked | Their inbound | - |
| `sendSms` `customer_confirmation` (booking, ready, estimate) | `sms_informational` | Prior express consent; not revoked | Booking or lead submission | [COUNSEL] confirms |
| `sendSms` `customer_marketing` (review requests, win-back, retention, drips, blasts) | `sms_marketing` | Prior express **written** consent (if counsel says the sender is an ATDS; Facebook v. Duguid narrowed that); DNC scrub for EBR-only sends | Shadow gate over implicit rows (F1) | [COUNSEL] then OPERATOR |
| `confirmationCalls` (AI voice) | `voice_ai_informational` | Prior express consent (a)(1)(iii) | Booking row | [COUNSEL] |
| `voiceRecovery` (declined-estimate recovery, AI voice) | `voice_ai_marketing` | **Written consent if telemarketing** (a)(2) | None. Operator kept it ON 2026-09-23, STOP-honoured (`CUSTOMER-CORPUS-RESEARCH-2026-09-23.md:387`) | [COUNSEL] classifies; OPERATOR decides |
| `followupCadence` (AI voice) | `voice_ai_marketing` unless counsel says informational | Same as above | None | [COUNSEL] |
| `makeFollowUpCall` (operator button) | Chosen by the operator per call: informational or marketing | Per purpose; refuses with the reason | Suppression only | OPERATOR |
| `emailCampaigns`, `dripProcessor` email | `email_marketing` | Not unsubscribed (CAN-SPAM needs no prior consent) | Suppression index | - |

**Quiet hours move into `decideContact`, so one function owns the window.**

- Allowed only when **both** the shop's lane window (ET, unchanged) **and**
  8:00-21:00 at the recipient's location hold (64.1200(c)(1)).
- The recipient's time zone comes from a static NANP area-code-to-zone table
  (the most-westerly zone for split area codes).
- An unknown or non-geographic area code gets the ET window only, and is
  flagged in the decision row.
- A ported mobile number can mislead the table. The intersection with the
  shop's already-narrow ET windows keeps that safe for Eastern and Central
  numbers. Western numbers are rare and shift later.
- DST is handled by `Intl` zone names, never fixed offsets.

## 7. Backfill (plan only; running it is an operator production write)

A script (`scripts/backfill-consent-ledger.mjs`) that is idempotent (every
row uses `INSERT IGNORE` on the unique key) and scoped:

- It prints its plan and counts in a **non-executing mode proven to return
  before any write** (prod-db-guard: a `--dry-run` flag is not a guard until
  shown to be one).
- It reports before and after counts per source.

| From | Becomes | `occurred_at` |
|---|---|---|
| Inbound bodies matching `SMS_OPT_OUT_KEYWORDS` (the index query, `sms.ts:203-210`) | `revoke`, `sms_keyword`, `evidence_ref = sms_messages:<id>` | message `createdAt` (exact) |
| `sms_preferences.opted_out = 1` | `revoke`, `backfill:sms_preferences` | `opted_out_at`, else `updated_at` with `estimated = 1` |
| `customers.smsOptOut = 1` | `revoke`, `backfill:customers` | `updatedAt`, `estimated = 1` |
| `audit_log` `sms.opt_out` | `revoke`, `backfill:audit_log` | `createdAt` |
| `audit_log` `sms.opt_in`, sources `booking_form` / `lead_form:*` | `grant` **`sms_informational` + `voice_ai_informational` only** (F1) | `createdAt` |
| Carrier-block notices | **Not backfilled.** A block is not consent (`sms.ts:78-91`); it stays a separate index source | - |
| Historical plain-English inbound (detector replay) | `hold` with `review_status = pending`, **never an automatic revoke** | message `createdAt` |

The last row needs to be said plainly. The replay may find past messages
that a reasonable person would read as a revocation, **followed by further
automated sends**. That is existing exposure the ledger surfaces; it does not
create it. The count goes to the operator and counsel before anything else
happens to it. Only counts leave the database, never message bodies (PII
rule 5).

## 8. Migration, rollout, tests

### 8.1 TiDB migration (nickstire-tidb-ddl rules)

- **Number.** The next free number when the build PR opens (`0130` is free
  on `f04e4d0`; re-check at that point, siblings take numbers).
- **Shape.** `CREATE TABLE IF NOT EXISTS`, `INFORMATION_SCHEMA`-guarded, so a
  re-run is a no-op.
  - **`VARCHAR` everywhere, no `ENUM`.** An out-of-enum write loses the row,
    and a lost revocation is the worst row to lose. Every value set above
    fits its width with margin; the longest `source` value listed,
    `backfill:sms_preferences`, is 24 of 48 characters. `lead_form:<src>` is
    bounded because `src` is a `z.enum` (`server/routers/lead.ts:50`); its
    longest value today gives `lead_form:financing_preapproval`, 31 of 48.
    Re-check the enum when widening it.
  - No generated columns and no `CREATE ... SELECT`.
- **Applying it.** Through an `apply-01xx-consent-ledger.mjs` shaped like
  `scripts/apply-0109-vapi-call-archives.mjs`, via
  `railway run --service MAINnicks-tire-auto`. Operator only. Never through
  `pnpm db:migrate`.
- **Code ahead of DDL.**
  - `schema.ts` ships with the migration.
  - Every read projects explicit columns: no bare `select()`, which would
    break against a database without the table.
  - Every write handles `isMissingTableError`.
  - `pnpm run check` is re-run after the apply.
- **Rollback.** The table is additive. Setting `CONSENT_LEDGER_MODE=off`
  makes the code ignore it. `DROP` only with explicit operator approval after
  an export: it is compliance evidence.

### 8.2 Rollout (OVERNIGHT-MANDATE 5)

| Step | Mode | What changes for customers | Needs |
|---|---|---|---|
| A. DDL + pure functions (detector, `deriveContactState`, `decideContact`) + tests | `off` | Nothing | LOOP PR, then the OPERATOR applies the DDL |
| B. Every write path in 5, the source-5 read, `consent.decision` rows; START fix | `shadow` | Nothing is blocked. Revocations are recorded and **would-block** decisions logged | LOOP PR (protected core); OPERATOR runs the backfill |
| C. Enforce suppression (revoke and hold) | `enforce_suppression` | Fewer sends, only to people who revoked or are held | OPERATOR flag, after the exit criteria below |
| D. Enforce grants, **one lane at a time** | per-lane allowlist | Lanes without the required consent stop reaching people who lack it | [COUNSEL] answers + OPERATOR per lane |

**Exit criteria from shadow to C** (all measured, none by judgement):

1. **Minimum length.** At least 14 days of shadow **and** at least 200
   `consent.decision` rows.
2. **Zero unexplained disagreements** between the live four-source index and
   the ledger-derived state. Each disagreement is listed and explained
   (backfill gap, timing) or fixed.
3. **Detector base rate reported.** `revoke / hold / none` over all inbound
   messages in the window, plus the reviewer's cleared share on holds (the
   false-positive rate).
4. **Hold review time.** Every hold reviewed within 1 business day; the
   median time is reported.
5. **Positive control in production.** A dedicated test handset, not a staff
   number (staff numbers are exempt as internal), does three things:
   - texts "please stop texting me";
   - says "stop calling me" on a call to the receptionist line;
   - clicks a one-click unsubscribe.

   Each must show a ledger event and a would-block decision within 5 minutes.
   A control that never fires proves nothing (positive-control-first).

**What must not regress.**

- Confirmation texts and informational calls to people who did not revoke.
  Watch the per-lane send counts against the 14 days before.
- The index's `ok` rate.

**Kill switch.** Set `CONSENT_LEDGER_MODE` back to `shadow`. The four existing
sources keep suppressing whatever the ledger's mode is.

### 8.3 Tests (red first where a fix is claimed)

**Detector fixture table** in `shared/revocationDetector.test.ts`:

- Every (a)(10) word, alone and with punctuation.
- Each high-confidence family.
- Each hold family.
- The `none` exclusions: "stop by", "end up", "reply STOP to" spam footers,
  "don't cancel my appointment".
- Curly apostrophes and all-caps variants.

**`deriveContactState`:**

- STOP then START (F2).
- A hold, then a release.
- A hold, then a revoke.
- A grant and a revoke at the same instant (revoke wins).
- An admin grant with no evidence is rejected.
- A backfilled revoke with an estimated time still wins over nothing.

**Index:**

- A ledger revoke appears in `phones`.
- A missing table in `shadow` keeps `ok:true` and logs.
- A missing table when enforcing gives `ok:false`.
- A ledger read error gives `ok:false` in every mode.
- `getSmsOptInIndex` returns the grants view and issues no query of its own
  (spy on `db`).

**Lane gate.** Extend `outboundLanes.suppression.test.ts` so every dialing and
email lane must call `decideContact(`. Add a planted-violation case (the
file's existing mutation style) proving the gate goes red.

**Vapi end-of-call:**

- A customer turn "stop calling me" writes a revoke.
- An **assistant** turn containing "stop" writes nothing.
- Webhook plus archive backstop for the same call writes one row.
- A structured-data `true` with a detector `none` writes a hold.

**Email:**

- A forged or expired token returns 400 and writes nothing.
- A `GET` writes nothing.
- A `POST` writes a revoke.
- An email linked to exactly one phone also writes the phone revoke.

**Disclosure:**

- An unknown `id@version` is refused.
- The recomputed hash equals the stored one.

**Quiet hours, with fake timers:**

- An ET number at 20:30 local.
- A Pacific area code at 10:59 ET (07:59 local: refused) and 11:00 ET
  (08:00 local: allowed), the boundary of the intersection.
- Both DST transitions.
- An unknown area code.

**Serial-mode hygiene** (nickstire `AGENTS.md` 3): `vi.unmock` for real
modules, env restored in `afterEach`.

## 9. Retention

- **Consent and revocation events** are kept for at least **5 years after the
  later of the event and the last contact with that subject**, and **never
  deleted while they are the reason a number is suppressed**.
  - The floor is the 64.1200(d)(6) 5-year duty to honour a do-not-call
    request.
  - The TCPA's 4-year federal catch-all limitations period (28 U.S.C.
    1658(a)) is below it.
  - **[COUNSEL]** confirms both and whether a deletion request can override
    them. Ohio has no comprehensive privacy law (master 10.3).
- **Excerpts** are the matched phrase only, at most 160 characters. The
  ledger never holds transcripts or message bodies.
- **Call transcript retention** stays with Q-52 (proposed: 24 months, then
  counts only, master 8 item 5). The ledger's `evidence_ref` may then point to
  an archive row that no longer exists. That is fine: the excerpt,
  `occurred_at` and `detector_version` are the retained evidence.
- **`consent.decision` rows in `audit_log`** follow the same 5-year floor for
  marketing sends. For other lanes, 24 months.

## 10. Open questions

**For counsel:**

1. Is each Vapi outbound lane (recovery, follow-up cadence, confirmation)
   telemarketing or informational? This decides step D, and whether the
   recovery lane may keep calling people without written consent, which is
   the operator's 2026-09-23 decision.
2. Is a bare "cancel" in reply to an appointment text a revocation of all
   consent (F5)? Does the (a)(12) confirmation text cover the combined
   cancel-and-unsubscribe reply?
3. Is giving a number on the booking or lead form prior express consent for
   AI-voice **informational** calls?
4. Approve the marketing checkbox text. Does a checkbox plus submit satisfy
   the (f)(9) signature via E-SIGN?
5. Is the shop's phone-gateway texting an ATDS after *Facebook v. Duguid*?
   This decides whether marketing texts need written consent or only DNC plus
   an established business relationship.
6. What happens with past plain-English revocations that the replay (section
   7) finds were followed by automated sends?
7. Retention floor and deletion requests (section 9).

**For the operator:**

1. Approve the rollout gates in 8.2, and who reviews holds (the owner, or
   named staff) and through which surface.
2. Apply the DDL and run the backfill when the build PRs land (production
   writes).
3. Decide whether the national DNC registry subscription is worth having, if
   counsel's answer to question 5 makes established-business-relationship
   marketing texts the path.
4. Provide a dedicated test handset for the positive control.

## 11. Out of scope, named so nobody assumes it is covered

- **Vapi opener content** (64.1200(b)): Q-45. Its opt-out tool writes to this
  ledger.
- **A second sending number or 10DLC route**: Q-38. `decideContact` is
  sender-agnostic.
- **Per-phone cooldown moving to the database**: master 6.4. Separate.
- **Reassigned Numbers Database lookups**: not designed. "Wrong number"
  handling covers the reactive case only.
- **The HMAC `customer_key` itself**: master 8 item 2. The column is reserved
  here.
