# Entity Continuity File — Nick's Tire & Auto (formerly Moe's)

Compiled 2026-09-16 from repo source only (no external API calls). Referenced but never
written since the 2026-08-19 War Room called for it ("assemble an Entity Continuity File...
before touching ANY directory," `docs/website-audit-status.md:100`). For use with Google
Business Profile support, BBB, Birdeye, Yelp, and Facebook when filing identity corrections.

Every fact below cites `file:line`. Anything not found in the repo is flagged, not guessed.

## 1. Canonical identity (current, correct)

| Field | Value | Source |
|---|---|---|
| Trade name (DBA) | Nick's Tire & Auto | `shared/business.ts:22` |
| "legalName" field as coded | "Nick's Tire And Auto" | `shared/business.ts:23` |
| Full legal-entity string (invoice-sourced) | "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005, moeseuclid@gmail.com" | `server/services/businessFacts.ts:130`, `factKey: "legal.entity"` |
| Address | 17625 Euclid Ave, Cleveland, OH 44112 | `shared/business.ts:38-46` |
| Phone | (216) 862-0005 | `shared/business.ts:29-35` |
| Hours | Mon–Sat 8AM–6PM, Sun 9AM–4PM | `shared/business.ts:70-84` |
| Website | https://nickstire.org | `shared/business.ts:9-19` |
| Founded (shop's own asserted tenure) | 2018 | `shared/business.ts:142-145` |
| Reviews | 4.9★, 1,700+ Google reviews (marketing floor) | `shared/business.ts:87-93,283-330` |
| Facebook | facebook.com/nickstireeuclid | `shared/business.ts:117` |
| Instagram | instagram.com/nicks_tire_euclid | `shared/business.ts:116` |
| Google Maps CID | 913066080091298245 | `shared/const.ts:14` |
| Google Places `place_id` | `ChIJSWRRLdr_MIgRxdlMIMPcqww` | `shared/const.ts:10` |
| GBP API location resource | `locations/18414488795645856692` | `docs/integrations/INTEGRATION_REGISTRY.md:34` |

**Legal-entity caveat.** The invoice-sourced fact literally reads *"Moe's Euclid Tire N Auto
LLC dba Nick's Tire & Auto"* — the LLC's registered name may still legally be "Moe's Euclid
Tire N Auto LLC," with "Nick's Tire & Auto" operating only as a DBA/trade name. This exact "N
Auto" wording is consistent across every citation in the repo, so it reads as a deliberate
transcription of the printed invoice, not a typo. **Not found in repo — ask the operator**
whether a DBA/fictitious-name filing was made with the Ohio Secretary of State, or whether the
LLC itself was formally renamed, before quoting either name to BBB or Google.

## 2. Former identity (being retired)

Old trade name, as variously rendered: "Moe's Euclid Tire N Auto LLC" (legal/invoice form),
"Moe's Tire & Auto", "Moe's Euclid Tire & Auto" (also the current live Facebook Page **Name**
field — see §4), "Moe's Tire" colloquially.

**Same owner, never sold — owner-confirmed 2026-09-03.**
`client/src/__tests__/canonical-business-truth.test.ts:173-176`: *"Nick's Tire & Auto is the
SAME owner, operating at 17625 Euclid Ave since BUSINESS.founded.year. The business was
RENAMED from Moe's Tire & Auto. Ownership never changed."* Enforced by a live test suite that
fails the build if any surface claims "run by Moe" or any of ten ownership-change phrasings —
`canonical-business-truth.test.ts:207-282`.

**Cause of the rename:** brand friction from unrelated competitor businesses also using
"Moe's" in the Cleveland market. `data/nour-context/master-context.md:107`: *"Other 'Moe's'
tire shops in Cleveland area created brand friction → led to name change."*

**Exact transition date: not found in repo — ask the operator.** The only dated marker is
"owner-confirmed 2026-09-03" — when the same-owner/renamed-not-sold fact was confirmed to the
code, not when the rename happened. The shop's tenure is asserted with **four different
years** across sources and the test suite explicitly refuses to pick a winner: 2018 (canonical
constant, 26 site surfaces), 2019 (twice, AI voice-guidance copy only), and **2022 (BBB's own
off-site record)** — `canonical-business-truth.test.ts:5-24` states plainly *"whether 2018 is
the right year is the owner's fact to settle — BBB says 2022 and this code cannot adjudicate
that."* BBB's 2022 date is worth asking the operator about directly.

## 3. Google Business Profile state

**Operator-confirmed 2026-09-16: `moeseuclid@gmail.com` is the operator's own account, used
for this shop location — not a former owner's account or a third party's.** Earlier drafts of
this file (and the repo's own prior framing) called it "the legacy Moe's account," which
overstated the situation — the trade *name* was formerly Moe's (§2), but the *Google account*
was never someone else's and needs no recovery or claim process. This is a same-day, two-step
task for the operator (sign in, verify the token changed), not a multi-party reconciliation.

- The live GBP listing's **owner Google account is `moeseuclid@gmail.com`** —
  `docs/integrations/INTEGRATION_REGISTRY.md:34`, confirmed independently at
  `docs/BUSINESS-LANDSCAPE.md:239` and `docs/website-audit-status.md:101`.
- The app's OAuth connection is currently authenticated as **`nourdean22@gmail.com`**, which
  *"manages zero businesses"* on Google — that token can never read the shop's data. This is
  purely a matter of the nickstire.org admin app being signed into the wrong of the operator's
  own two Google accounts; nothing here is inaccessible to the operator.
- A re-Connect as `moeseuclid@gmail.com` was logged **pending verification** as of 2026-07-29
  (refresh-token fingerprint `sha256:16a903b7…`, length 103). The 2026-09-08 status entry still
  describes this as outstanding — treat the reconnect as **not confirmed successful**.
- **Blocking:** GCP project `740034351591` has **quota=0 on all three GBP APIs** until the
  [Business Profile API access form](https://support.google.com/business/contact/api_default)
  is approved. The form requires the profile to be verified 60+ days with the website listed.
- **What's blocked meanwhile:** `gbp.performance` (calls, website clicks, direction requests,
  search keywords), the map-pack scoreboard, review-ingest verification.
- **Wart to know before reconnecting:** `gbp.reconnect` saves the token *before* its
  accounts-list call 429s, so an error toast after consent does not necessarily mean the
  connect failed — check whether the stored refresh-token fingerprint actually changed.

**Exact next operator action:**
1. In nickstire.org admin → Content & AI → GBP, click Connect/Reconnect and sign in specifically
   as **moeseuclid@gmail.com** — not nourdean22@gmail.com.
2. Verify it actually took — check whether the stored refresh-token fingerprint changed from
   `sha256:16a903b7…`.
3. Submit the Business Profile API access form for project `740034351591`, once the profile has
   been verified 60+ days with nickstire.org listed as the website.
4. Treat any name/category edit on the GBP listing itself as a **major name change** under
   Google policy, not a minor field edit.

On the GBP listing's current display name: the repo cannot read this live (API quota-blocked),
but Maps URL slugs constructed elsewhere in the code ("Nick's+Tire+And+Auto+Euclid") suggest
the listing's Name field is already Nick's — an inference from URL slugs, not a verified API
read. Confirm directly once access is restored.

## 4. External identity matrix

| Platform | What it currently shows | Claimed? | Correction needed |
|---|---|---|---|
| **Google Business Profile** | Likely already "Nick's..." by URL-slug inference; NAP otherwise canonical. Owning account `moeseuclid@gmail.com`. | Yes (by moeseuclid), but app-side API access is blocked and mis-connected | Fix access per §3. This is the anchor identity — settle it first. |
| **Birdeye** | Still under "Moe's" name, **1,763 reviews** | **Unclaimed** — excluded from the ranked list AI engines cite | `docs/website-audit-status.md:100`. Claim the profile, update to Nick's Tire & Auto. |
| **BBB** | Phone **WRONG: 682-0005** (transposed — correct is 862-0005); founding year recorded as **2022** vs canonical 2018 | Needs correction | Phone correction + name-change request. Test-guarded: `canonical-business-truth.test.ts:12,23,31,110` exists specifically because "BBB already carries 682-0005." |
| **Yelp** | A "Monro" ghost listing owns the address at 17625 Euclid Ave (most recent finding, supersedes an older note about searching "Moe's Tire Euclid" on Yelp) | Not claimed under Nick's | Claim/create the correct Nick's listing; separately resolve the Monro ghost entry with Yelp support. Yelp prohibits review solicitation once claimed. |
| **Facebook** | Page **Name field literally still reads "Moe's Euclid Tire & Auto"** — confirmed via Graph API metadata. Address and connected Instagram are already correct; public URL slug is already `nickstireeuclid`. | Yes, owned/operated | `server/services/metaSocial.ts:816-821`: *"the owner was told explicitly and accepted it while the Facebook page is sorted out."* Operator-deferred, not an oversight — re-raise once the platforms above are settled. Correction: rename the Page's Name field on Meta's side (not a code change). |
| **Legacy Google Sites microsite** | Unknown exact URL/content — off-site, outside this codebase | Operator-accessible if it lives under `moeseuclid@gmail.com` (confirmed the operator's own account, §3) | Still live and listed as the "official website" by BBB/Birdeye/AutoTechIQ (`docs/website-audit-status.md:100`). **Not found in repo:** its URL or displayed NAP. Since `moeseuclid@gmail.com` is confirmed operator-owned, check Google Sites under that account first — this is likely a quick find, not an unknown-ownership mystery. Then either redirect it to nickstire.org with correct NAP or take it down, and get BBB/Birdeye/AutoTechIQ to repoint their "official website" field. |
| **AutoTechIQ** | Also points to the legacy microsite as "official website" | Unknown | Contact support to update or remove. |

## 5. Do-not-confuse warning

**"Moe's Tire Center" is a separate, real, currently-operating competitor business — never
touch, claim, or file a correction against it.**

- Tracked in the shop's own competitor-monitoring baseline: **4.3★, 639 Google reviews** —
  "Largest review volume in the set." (`client/src/lib/competitorGbpMonitor.ts:25-28`)
- A second, distinct listing **"Moe's Tire Center 3"** also appears in the watch list (4.2★,
  379 reviews), likely a second location of the same competitor chain. Both are unrelated to
  Nick's own former "Moe's Euclid Tire N Auto LLC" identity.
- Explicit in-repo framing: this competitor's existence is *why* the rename happened in the
  first place (§2) — `data/nour-context/people-map.md:44-45`: *"former brand kin, now
  adversarial. Rule: Don't engage."*
- The repo does not store a street address for either "Moe's Tire Center" listing — confirm the
  exact address directly (e.g. via Google Maps) before doing anything that could touch it.
- **Practical rule:** before claiming, editing, or disputing any listing found while correcting
  Nick's "Moe's Euclid..." identity on Birdeye/BBB/Yelp/GBP, confirm the address on that
  specific listing is **17625 Euclid Ave, Cleveland, OH 44112**. If it isn't, it is very likely
  a different business and must be left alone.

## 6. Recommended sequence

1. **Freeze the canonical NAP** to §1, and resolve the open legal-entity question with the
   operator (registered LLC name vs. DBA status) before quoting either name to BBB or Google.
2. **Audit both identities side by side** — §4 above — before changing anything.
3. **Settle the canonical GBP identity first** — execute the §3 reconnect sequence and treat
   any GBP name/category edit as a major name change, not a minor edit.
4. **Correct tier-one platforms first** — GBP is the dominant cited source in AI
   Overviews/AI Mode; Yelp is the most-cited source in ChatGPT. Claim the correct Yelp page
   (no review solicitation), resolve the Monro ghost entry.
5. **Then the aggregators** — BBB (name + phone), Birdeye (claim the 1,763-review "Moe's"
   profile), AutoTechIQ, and get all three off the legacy microsite as "official website."
6. **Facebook** — rename the Page's Name field; operator-deferred, re-raise once 3–5 are done.
7. **Only then pursue new citations/directory listings** — adding new citations onto an
   unresolved identity fracture creates a fourth or fifth colliding record instead of
   consolidating the existing ones.

## Provenance note

`docs/website-audit-status.md:100,102` cite a "war-room artifact §16" and "§11" as holding the
full detailed sequence. That artifact is not a tracked file in this repo — see
`apps/nickstire/docs/website-audit-status.md` for the inline echoes of its conclusions, which
are what this document is built from. The full original artifact (if it still exists) lives
outside this repository.

Sourced live-data findings that motivated re-checking this file (2026-09-16, via Chrome
Search Console access authenticated as the operator): GSC property added to account
**2026-03-17** (`Settings → About`); current listed Search Console users are
**moeseuclid, nickstire-server, Nourdean Rabah** — `moeseuclid@gmail.com` (the operator's own
account, §3) still has GSC access on the *website* property as well as GBP, not just GBP.

**Correction, 2026-09-16 (post-merge):** this file's earlier drafts called `moeseuclid@gmail.com`
"the legacy Moe's account" throughout — operator-confirmed it's simply their own account for
this location, not a former owner's or third party's. §3 and §4 corrected accordingly. The
underlying facts (owning account, OAuth mismatch, blocked API quota, correction sequence) are
unchanged — only the framing of *why* the account is separate from the app's current OAuth
connection was overstated.
