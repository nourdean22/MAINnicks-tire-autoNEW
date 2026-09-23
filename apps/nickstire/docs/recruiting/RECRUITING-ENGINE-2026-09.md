# Nick's Tire & Auto - Technician Recruiting Engine (research report, 2026-09-23)

> Research snapshot. Rank 7 in the source-of-truth hierarchy: dated, re-verify market numbers and competitor offers before acting. Code shipped from this plan is listed in the PR that added this file.

Research date: 2026-09-22/23. Evidence tags: **[V]** verified primary | **[S]** secondary/vendor/snippet | **[A]** anecdote | **[H]** hypothesis/experiment | **[UNK]** unknown.

## Context
The owner wants a steady supply of strong technicians (master/diagnostic, tire/hybrid, apprentices, service advisors), including techs who already have jobs, drawn from Euclid, Cleveland and Northeast Ohio. Nick's already has a recruiting system: `/careers`, 3 job pages, a `candidates` table, `technician_referrals` ($300 paid after 90 days), an admin panel with a 48h reply alarm, UTM capture, and manual Indexing API + IndexNow scripts. The software is not the main constraint. The bigger constraint is the **offer and the proof behind it**, not the software.

---

## 1. Answer first: the six things that decide this

1. **The pay ceiling is below a direct competitor a few miles away.** Nick's advertises "Up to $35/hr for master techs." Enterprise Mobility opened a service center at **25080 Lakeland Blvd, Euclid**. It pays **$30.00-$37.50/hr: a $30 start that requires 4 ASE certifications, plus $1/hr per ASE after those 4 (up to 8), with medical/dental/vision, a retirement plan, PTO and a $400/yr tool stipend** [V enterprisemobility.com posting 558870, updated 2026-09-04, re-checked 2026-09-23]. Its **Lube and Tire Technician starts at $20/hr** [V postings 552533 (Euclid) and 562425 (Cleveland)]. (An earlier draft also cited "$25.50-$37.50 in other postings"; no posting shows that band - it spliced two different roles [UNK].) There is also an unnamed Euclid posting at "$35/hr, 40+ hours guaranteed, NO flat rate" [S]. GCRTA advertises "$27.80/hr NO FLAT RATE" [V riderta.com 2026-03-13] and USPS Cleveland pays $30.61/hr with federal benefits [V]. The Cleveland MSA mean for occupation 49-3023 is **$27.71/hr** (BLS OEWS May 2025) [V]. "Up to $35" with no floor, no benefits listed, a 7-day shop and "bring your own tools" loses to Enterprise with any tech who compares. **No marketing fixes an offer that loses on a pay comparison.**
2. **The "we keep techs busy" claim can't be proven with the data we have, and our own data may contradict it.** `docs/CURRENT-TRUTH.md:293` records **104-143 paid invoices a month** (Mar-Jul 2026) in the ShopDriver mirror, about 4-5 a day. The About page says "~32 jobs/day max" and business.ts says "50+ used tires per day." Either the mirror undercounts (cash or walk-in tire sales never reach ShopDriver) or the public volume claims are inflated. Reconcile this before any workload claim goes public.
3. **Google Jobs data is incomplete, and browsers see a different page than bots.** No JobPosting has `baseSalary` [V live + `shared/jobOpenings.ts:113`]. Normal browsers get an empty SPA shell; only UA-matched bots get prerendered JSON-LD [V]. **Indeed's crawler is not in `BOT_PATTERNS`** (`server/prerender-middleware.ts:20-88`). Indeed's free organic channel is career-site crawling [V HR Dive/Indeed 2026], so if Indeed identifies itself as "Indeed...", it currently sees an empty page [H, confirm in access logs]. A made-up `/careers/<slug>` returns **HTTP 200 with the homepage** (soft-404) [V].
4. **Applicants get no reply and the owner gets no alert.** `candidates.submit` sends no owner notification and no acknowledgement to the applicant [V code audit]. The 48h alarm exists only inside the admin panel. Industry evidence: techs assume no interest after 1-2 days of silence [S ASE Connects 2025].
5. **"Most reviews" can't be claimed yet.** Nick's shows 4.9 / ~1,710 Google reviews from its own Places API pull [V code, the count itself not independently confirmed]. Nearby numbers found: Firestone Euclid 338 (Birdeye), Conrad's Mayfield Hts 931 (Michelin), NTB Mayfield 554, **Confident Tire Euclid 1,530 on SureCritic** (their Google count is unknown) [S]. A "most reviewed" claim needs a dated Places API comparison. Until that exists, say "4.9 stars across 1,700+ Google reviews."
6. **Brand-identity leak.** facebook.com/nickstireeuclid is still titled **"Moe's Euclid Tire & Auto"** [S]. A skeptical tech checking the shop out sees a name mismatch.

## 2. Owner hypotheses: verdicts and how to prove each

| Hypothesis | Current status | Proof needed before publishing | Credible phrasing once proven |
|---|---|---|---|
| Less corporate; you can be yourself | Plausible but not proven [H] | Written policy in the offer letter (dress code, tattoos/piercings, music/headphones where safe, no scripted upsell quotas); 2+ unscripted current-tech videos with employment disclosed (FTC 16 CFR 255 [V]); owner commitments (below) | "No sales quotas for techs. No scripted upsells. Wear what's safe. Your music, your bay." Only list what is written policy. |
| Bread-and-butter work is easy for a master tech | Partly supported: service mix is tires, brakes, diag, maintenance (`shared/services.ts`) [V]; the Careers page already says "You won't be dropping motors" | Job-mix breakdown from 90 days of invoices/work orders (share of jobs by category) | "Last 90 days: X% tires/brakes/maintenance, Y% diagnostics. Heavy engine/trans work is rare." Show the percentages. |
| We can keep good techs busy | **Unproven, and possibly contradicted** (finding #2) | Workload Proof audit (Sec.6) | Publish only billed or clocked hours per tech per week, with methodology |
| Review footprint is a recruiting asset | True as proof of *customer demand*, not employee satisfaction [V reasoning] | Dated Places comparison (Sec.7) | "4.9 stars, 1,700+ Google reviews = steady customer demand. It doesn't tell you what working here is like, so ask our techs." |

**Survey data on what techs value** (WrenchWay/ASE 2025-26, n~5,500 [S]): 84% say higher pay is most urgent. Pay-plan preference: hourly/salary 36%, hourly plus production bonus 25%, flat rate with 40h guarantee 19%, straight flat rate 18%. 87% want pay shown in the posting. 87% say proper equipment is a must-have and 83% say paid vacation is. 65% have left or considered leaving because of a manager. 44% will work weekends *for the right incentive*. Dealer turnover runs D-tech 67% vs A-tech 18% (NADA 2025 via third party) [S]. Reddit could not be fetched, so community sentiment rests on thread titles only [A]. Treat claims of "dealer politics / dispatch favoritism" as plausible but not quantified here.

**Positioning (strongest truthful version):** *"Hourly, not flat rate. Steady independent-shop work, no dealer warranty clock, no corporate script. See the numbers before you apply."* This competes on **predictability, autonomy and transparency**, not on the highest wage. It only works with a floor rate that is competitive with Enterprise and a published guarantee.

## 3. Compensation architecture (owner decision; illustrative numbers, not recommendations)

Assumptions to replace with real ones: 45 clocked hours a week, a 7-day shop, an Enterprise A-tech at about $34/h x 40h.
- **Option A, hourly floor + production bonus (matches the 25% preference and the "no flat-rate grind" promise).** Base $30-34/h guaranteed for 40h, plus $X for each billed hour above a weekly threshold, plus an ASE step-up of $0.50-$1/cert (mirrors Enterprise). Includes a diagnostic premium and a comeback rule: re-work on your own comeback is unpaid for bonus purposes only (base pay is never touched).
- **Option B, a published weekly guarantee.** "40h x $32 guaranteed, paid weekly," which answers the flat-rate fear directly.
- **Schedule as currency.** The shop is open 7 days. Offer a guaranteed 2 consecutive days off, **Sunday only by choice at a premium** (the 44%-for-incentive data point). Consider 4x10 (32% preference) [S].
- **Tool program instead of cash.** Specialty tools provided (already true); add a tool allowance or toolbox-move assistance. Legal constraint: tool costs may never push pay below minimum wage or overtime (29 CFR 531.35) [V].
- **Legal flags for counsel/payroll:** Ohio minimum wage $11.00 (employers over $405k gross) [V]. The **13(b)(10) overtime exemption does not apply to an independent shop** [V Encino]. The 7(i) commission exemption for flat rate is uncertain in the 6th Circuit (Yi v. Sterling is 7th Cir.) [V], so any flat-rate component needs counsel. Sign-on clawbacks go by contract, never by deduction from final wages. **Working interviews must be paid** (DOL dental case) [V]. Cleveland pay-transparency ordinance Ch. 669 applies to employers with 15+ employees in Cleveland [V Jackson Lewis]; Nick's (a Cleveland address) is probably below the threshold. Publish pay anyway.

**Referral economics:** $300 is low. Trade norms are $500-1,500, paid half at hire and half at 90 days [S ServiceTitan/ASE Connects]. Referral hires stay longer (iCIMS vendor study: 50% stay 38+ months vs 22 months [S, vendor]). Agency fees run 20-30% of first-year pay (~$12-20k for a $60k tech) [S]. So a **$1,000 A-tech / $500 tire-tech tiered bounty** (half at hire, half at 90 days) is rational if even one agency fee is avoided. The "customers who refer a hire get free services" promise has **no backing record**. Either wire it or delete the copy.

## 4. Channels, ranked (leverage x evidence / cost)

| Rank | Channel | Why | Cost | Evidence |
|---|---|---|---|---|
| 1 | **Fix own site plus Google Jobs** (baseSalary, crawler parity, 404s) | Indeed and Google both pull from it for free | eng hours | V |
| 2 | **Tri-C job board**: email postings to **autotech@tri-c.edu**; Program Director Melissa Koenig 216-987-5330; Tri-C Handshake | 40+ employers listed incl. Enterprise/Tesla/Ganley; Tri-C ranks for "automotive technician jobs Cleveland" | free | V |
| 3 | **Referral engine** (tiered bounty, personal links/QR, vendor and tool-truck reps) | best retention of any source | bounty only | S |
| 4 | **ASE Connects** (formerly WrenchWay, bought by ASE 2026-06-30): $750/yr per location, **free through 12/31/26 if you contribute pay data**; the free trial excludes the Top Shop Career Page (+$250); "School Assist covers 3,200+ schools" is not on the current pages [UNK] | tech-specific audience plus pay data | free now | V |
| 5 | **Career-tech schools**: Euclid HS / Lake Shore Compact CTE 216-797-7830; CVCC (ASE-accredited) 440-526-5200; Northern Career Institute (Willoughby, live-shop program); Excel TECC; Polaris; Auburn; Max Hayes; Ohio Technical College 216-881-9145 (**still operating**) | apprentice and tire-tech pipeline | time | V |
| 6 | **OhioMeansJobs** free posting plus **Greater Cleveland Works OJT** (WIOA reimburses up to 50% of wages during training; OMJ 216-777-8200) plus OMJ Lake 440-350-4320 | subsidized apprentice hires | free | V |
| 7 | **Indeed**: rely on free crawl of career site; free hosted = 3 jobs/mo, 30 days; Sponsored is PPC or pay-per-started-application | volume, mixed quality | $ | V |
| 8 | Meta Employment ads (15-mile minimum radius, no lookalikes/ZIP/age/gender) retargeting careers visitors plus local reach; TikTok/Reddit similar restrictions | passive techs; creative-dependent | $300-600 test | V policy / H results |
| 9 | Car community: SCCA NEOHIO autocross (Sep 27 Willowick; Oct 24 rally), Cars & Coffee Cleveland (Mentor, fall finale Oct 11) | enthusiasts and moonlighters; brand building | low | V exist / H yield |
| - | Registered apprenticeship (RAPIDS 1034CB competency-based or 0023R1 8,000h) | TechCred (window **Oct 1-30, 2026**; per-credential amount conflicts: $1k vs $2k) | SkillBridge (Oct 1-Dec 1 window; business must be 3+ yrs old) | Federal Bonding / CQE second-chance | Towards Employment | P1/P2 programs | free | V |

**Not worth it now:** LinkedIn (1 free job, 14-day pause; few techs), ZipRecruiter ($299-899/mo per slot), recruiting agencies except for one urgent master-tech hire, JobsOhio Technician Path (auto repair not a target industry), WOTC budgeting (lapsed 12/31/2025; file 8850s anyway in case Congress renews it retroactively), UTI/Lincoln (no Ohio campus; UTI free post form only), Lakeland CC and Lorain CCC (no auto program).

## 5. Site and search audit: preserve, fix, add
- **Keep:** the job-page architecture (one job per page, hub without JobPosting, prerendered, sitemap, correct canonicals, `directApply:true` because the form is on-page), the shop voice ("You won't be dropping motors"), the "no resume required" form, and the referral block.
- **Fix:** add `baseSalary` hourly min/max plus the same range shown visibly near the H1. Make `description` HTML with `<ul><li>` and include "What we need" plus hours. Swap the logo from favicon.ico to a PNG. Unknown or closed slugs must return a server 404/410 (with `URL_DELETED` via the existing script). Remove "Competitive pay, growth opportunities, modern shop" and "apprentices" (no apprentice role) from `routes.ts:1296`. Service advisor pay is missing. `validThrough` 2026-12-31 expires every role at once; roll it automatically.
- **Crawler parity:** confirm the Indeed crawler UA in Railway logs, add the token to `BOT_PATTERNS`, and assert it in a test.
- **Search reality:** nickstire.org does not rank for generic job queries (Indeed/Glassdoor/ZipRecruiter/Tri-C dominate) [S, WebSearch]. The winnable levers are **Google Jobs inclusion** (needs complete markup) and **long-tail content**. Autocomplete confirms demand phrasings: "flat rate vs hourly mechanic (reddit/salary)", "how much does a mechanic make in ohio", "auto mechanic jobs cleveland ohio", "apprentice/entry level automotive technician jobs" [V autocomplete]. **Volumes are unknown** (Ahrefs out of units). Measure via GSC `scripts/gsc-snapshot.mjs --careers` and Keyword Planner before building content.
- **Content moat, in priority order:** (1) *Flat-rate vs hourly pay calculator* (answers the highest-intent phrase family and sells Nick's hourly model) [H demand, V phrasing]. (2) *Cleveland technician pay page* using BLS + posted ranges with citations (linkable by Tri-C/schools) [H]. (3) *Tire-tech -> A-tech roadmap* (apprentice funnel) [H]. **Skip:** city-by-city job doorway pages, generic "how to become a mechanic" content.

## 6. Workload Proof system (internal first, publish later)
Metrics that matter to a master tech: **billed/flagged hours per tech per week**, **clocked hours per tech per week**, **% of weeks a tech hit 40h**, **days booked ahead**, **job mix %**, **comeback rate**. Vanity: reviews, calls, "vehicles serviced" without hours.
Data we have: `invoices` (ShopDriver mirror; **labor/parts split dead since 2026-04-09**), `work_orders` + `work_order_items.laborHours`, `time_clock_entries`, `job_assignments`, `staffPerformance.ts`. Coverage of each table is **[UNK]**; this is a prod read, so the orchestrator runs it under the prod-db-guard skill.
Steps: (1) an admin-only read-only "Workload Evidence" query with 90-day trailing weekly series and **empty-vs-error** handling (never render a failed read as 0). (2) Reconcile invoice counts against ShopDriver's own reports and tire walk-in volume. (3) The public module shows only metrics that survive reconciliation, as weekly medians (not peaks), with an "updated <date>" stamp, a methodology link, **no revenue $, no customer data, bucketed ranges** (e.g., "40-48 clocked hrs/week, median tech, last 12 weeks"). Anti-gaming rule: the same query feeds admin and public; there is no manual override field.

## 7. Review proof
A script (read-only, external) calls the Places API Text Search for "tire shop"/"auto repair" within 5 mi of 17625 Euclid Ave and captures `userRatingCount` + rating with a timestamp into a JSON snapshot in `docs/`. If Nick's is #1, the permitted claim is "Most-reviewed tire & auto shop within 5 miles on Google (checked <date>)"; re-check quarterly. Check Places API terms on storing/displaying data first. In recruiting copy, always frame reviews as proof of **customer demand**.

## 8. Candidate communication funnel (build on the existing tables)
Intents on one form, stored in the **existing `candidates` table** via a new `intent` column (no new table): `apply` | `confidential_question` | `shop_tour` | `talent_network` | `apprentice_interest` | `refer`. Flow:
1. Submit -> **owner alert within 60s** (SMS to owner phone + email via existing `server/sms` and `email-notify.ts` helpers; internal alert, flag-gated).
2. Applicant acknowledgement by email (Resend) immediately. SMS acknowledgement **only with an explicit consent checkbox and a registered A2P 10DLC recruiting campaign** (vetting $4 + $15, 1-4 weeks) [S Twilio]. Message names the shop (FTC fake-recruiter scam warning 2026-04).
3. SLA: target 15 min during business hours, hard 24h. The existing `candidateSla.ts` bands get a cron that texts the owner at "urgent".
4. Scheduling: a Google Calendar appointment link or hosted Cal.com (do **not** self-host; Cal.com went closed-source 2026-04, cal.diy fork).
5. Talent-network follow-up: the existing cron plus a `nextActionAt` column; quarterly check-ins by email, with unsubscribe (CAN-SPAM).
6. Anti-spam: Cloudflare Turnstile + server `siteverify`; `libphonenumber-js` E.164 dedupe across candidates and referrals.
7. Resume (P1): optional upload to existing S3, PDF/DOCX <=5MB, magic-byte check; ClamAV sidecar only if volume warrants it; `unpdf` for preview text. `jobs@nickstire.org` via **Resend Inbound** (already a dependency).
8. Attribution: add `gclid`, `utmTerm`, `utmContent` to the candidate insert (already captured client-side in `client/src/lib/utm.ts`), plus a `refCode` for personal referral links `/r/:code` (QR via the existing `qrcode.react`). Add GA4 key event `careers_application_submitted` and a Meta `Lead` event.
Retention/privacy: purge declined or withdrawn candidates after 24 months; minimal PII in logs; no PII in analytics payloads.

## 9. Passive/outbound sourcing (ethical)
One-to-one only. Sources: referrals, tool-truck reps (informal; Snap-on/Matco/Mac are independent franchisees, so there's no policy either way [A]), parts-counter reps, tow operators (TRAO), instructors, school alumni, car clubs, and former employees (boomerang list from the `technicians` table). Never: scraping, purchased lists, asking a candidate for a competitor's customer lists, or inducing breach of a non-compete. Ask every candidate for any agreements they have signed (Ohio Raimonde test; FTC rule removed Feb 2026) [V]. Use Indeed Smart Sourcing / OMJ resume search only if the funnel is starved. Measure contacts -> replies -> conversations -> hires per source in the CRM.

## 10. Creative engine (all [H], test cheaply)
A weekly 30-45 s vertical clip filmed by the techs themselves (disclose employment on screen). Formats: "What came in today" (job-mix proof), "Diag of the week," "Pay plan in 60 seconds" (owner explains the floor, bonus and guarantee), "Bay tour, no script," "Day off is a day off." Reuse the existing reel pipeline only for editing/assembly. **Publishing needs explicit owner approval** (protected operation). Kill any format with <1 careers click per 1,000 views after 4 posts.

## 11. Measurement
Funnel events: `careers_view` -> `job_view` -> `cta_click` (exists) -> `form_start` -> `careers_application_submitted` (exists) -> admin statuses (`contacted`->`interviewing`->`offer`->`hired`) -> retained at 30/60/90 days (from the `technicians` start date). Add `offer` and `started` statuses and `hiredAt`/`startedAt`. Per-source metrics: cost per qualified candidate, cost per interview, cost per 90-day-retained hire, median time-to-first-contact, show rate, offer acceptance. Report counts with base rates (base-rate-check skill). Kill criteria are listed per experiment in Sec.12.

## 12. Sequenced execution

### P0 - next 24h / 7 days (owner actions, no code)
1. Owner sets a **published floor rate, guarantee, schedule rule (2 days off, Sunday optional) and a benefits list**, and a service-advisor range. Nothing is published until this exists.
2. Rename the Facebook page from "Moe's Euclid Tire & Auto."
3. Email the job links to autotech@tri-c.edu; register on Tri-C Handshake; create an OhioMeansJobs account; call Greater Cleveland Works about OJT.
4. Sign up for the ASE Connects free trial (contribute pay data).
5. Pull Railway access logs for `/careers*` and identify the Indeed crawler UA.
6. Start the A2P 10DLC recruiting campaign registration (long lead time).

### Decisions locked (operator, 2026-09-23)
- **Pay = match Enterprise Euclid:** Automotive Technician **$30.00-$37.50/hr**; Tire/Hybrid Technician **$22.00-$25.50/hr**; Service Advisor **left blank** (no `baseSalary`, no visible figure) until the owner gives a number.
  - **Correction (2026-09-23, after publishing):** the auto-tech band matches Enterprise exactly [V 558870] - but Enterprise requires 4 ASEs for its $30, where Nick's asks 2+ years with ASE optional. The **tire/hybrid band was presented as Enterprise's and is not**: Enterprise's Lube and Tire Technician starts at **$20/hr** [V 552533, 562425]; its $22 figure is an Associate role requiring 2 years + 2 ASEs. So $22.00-$25.50 sits about **$2/hr above** Enterprise's tire start (near the Cleveland tire-repairer 75th percentile, $22.82, BLS May 2025). It stays live until the owner decides: keep (a real edge over Enterprise) or change to $20. The in-form helper text "Up to $35.../up to $25..." gets replaced by these ranges so the markup and visible copy match (Google requires this). These are public pay floors Nick's must honor.
- **Scope = report + P0 + P1 code** in one branch/PR, split into logical commits.

### P0 - code (this branch `claude/funny-gates-asubwi`, nickstire app)
- `shared/jobOpenings.ts`: set `payMin/payMax` to the locked ranges above (unit HOUR). `buildJobPostingSchema` emits HTML description, a PNG logo, and `experienceRequirements`. Add a unit test that fails when an open role lacks `baseSalary` (positive-control-first: run it red first).
- `client/src/pages/JobPage.tsx` + `Careers.tsx`: a visible pay/schedule/guarantee block above the fold. Tel + "text us" CTA on job pages. Referral explainer. Remove the free-services-for-customers copy unless wired. Fix `routes.ts:1296` meta.
- Server 404 for unknown or closed `/careers/:slug` (touches the prerender/route surface; read `PROTECTED-CORE.md` first; the cloaking incident ROS-101 is precedent).
- `server/prerender-middleware.ts`: add the verified Indeed UA token + test.
- `server/routers/candidates.ts`: owner alert on submit (flag-gated, default off until the owner flips it) + email acknowledgement to the applicant if an email was given. Reuse `email-notify.ts` / existing SMS helper. Add Turnstile verification + E.164 normalization.
- Candidate insert: pass `gclid/utmTerm/utmContent`. Schema change -> `nickstire-tidb-ddl` skill; hand-applied migration; owner applies.
Reuse: `candidateSla.ts`, `CandidatesPanel.tsx`, `technicianReferrals` router, `utm.ts`, `trackEvent`, `scripts/indexing-api-submit.mjs`.

### P1 - 30 days (code items are IN this PR; owner/field items are not)
Code in this PR: `intent` column + multi-intent CTAs (confidential question / shop tour / talent network / apprentice). Tiered referral bounty (config, not a hardcoded 30000) + `/r/:code` links + QR cards for vendors and tool reps. SLA cron alert. Resume upload + Resend inbound jobs@. Admin Workload Evidence query (internal). Places review snapshot script. Flat-rate vs hourly calculator page. School visits (Euclid HS, CVCC, NCI). Auto-roll `validThrough` and fire Indexing API on open/close.
Code guardrails for P1: every new column goes through `nickstire-tidb-ddl` (one hand-applied migration file, owner applies it; code must tolerate the column being absent until then). New cron/queue/flag -> `prior-art-grep` first. Workload query -> `empty-vs-error` + `prod-db-guard` (no prod reads from this container; ship the query, owner runs it). Referral links -> `claim-before-act` on payout transitions (existing state machine already CAS-guards; extend, don't fork). All outbound SMS/email stay behind flags defaulting OFF. (Superseded 2026-09-23: the operator turned all three careers lanes ON - owner text, owner email, applicant email - each with its own `=off` kill switch.)
Owner/field work (not code): school visits, Places snapshot run, TechCred filing.
Kill criteria: a channel with 0 qualified candidates after 30 days -> cut. Calculator page with <50 organic sessions/mo after 90 days -> stop investing.

### P2 - 90 days
Public Workload Proof module (only if reconciled). Meta Employment-category test ($300-600, 15-mi radius, retargeting careers visitors): kill if cost per qualified candidate is more than 2x the referral cost. Registered apprenticeship sponsorship + TechCred application (Oct window may be missed -> next round). Cleveland tech pay page. Talent-network quarterly email (Listmonk not needed; Resend broadcast).

### Do NOT build/do
Self-hosted ATS/CRM (OpenCATS/Twenty/Espo/Odoo/Frappe: duplicates the existing candidates + admin panel). Workflow engines (n8n/Activepieces/Windmill/Trigger/Inngest: the existing cron suffices). BullMQ/pg-boss (Redis/Postgres only, not TiDB). Resume parsers and semantic matching (5-20 hires/yr; the owner reads everything). Self-hosted Dub/Shlink. Job XML feed (not needed: Indeed's 2026-03-31 policy hides free single-source feeds that could come through an integrated ATS - non-integrated feeds stay eligible [HR Dive] - and Indeed still crawls career sites, which Nick's now serves fully). LinkedIn/ZipRecruiter spend. City doorway pages. Any "most reviewed" or "busiest" claim before Sec.6/Sec.7 evidence exists. Unpaid working interviews.

## 13. Blind spots / risks
- **The offer, not the funnel, is the bottleneck.** More traffic to an under-market offer burns candidate goodwill in a small labor market.
- **Owner response capacity:** a 15-minute SLA needs a named responder and a backup; otherwise alerts become noise.
- **The 7-day schedule plus bring-your-own-tools** cuts against survey preferences; mitigate with written schedule rules and a tool allowance.
- **Low-quality flood from "be yourself" framing:** pair it with hard requirements (years, ASE, diagnostic tools) on the job page.
- **Poaching disputes:** document non-compete checks; never solicit a competitor's staff through their customers or on their premises.
- **Testimonials:** employee content must be voluntary, unscripted and disclosed; no incentives tied to positive statements.
- **Data:** the ShopDriver money fields are dead since April. Any metric built on `laborCost`/`partsCost` after 2026-04-09 is a fabrication.

## 14. Least-obvious, highest-leverage ideas
1. **Indeed crawler parity:** a one-line prerender UA fix may restore the free Indeed channel [H, verify logs].
2. **Enterprise Euclid is the benchmark.** Build the offer page as a line-by-line answer to it (pay floor, hours, schedule, tools, benefits) [S].
3. **ASE Connects pay-data trial:** free through 12/31/26 and puts Nick's in front of 3,200+ schools [V].
4. **Tri-C job board is an email, not a platform:** autotech@tri-c.edu, zero cost [V].
5. **Greater Cleveland Works OJT:** up to 50% wage reimbursement for apprentice/tire-tech trainees [V].
6. **Referral bounty paid as tool-truck credit** (a tool-truck finder fee/credit in place of cash) turns tool reps into recruiters [A, test].
7. **Publish the pay-plan math** (flat-rate vs hourly calculator) where techs already search "flat rate vs hourly mechanic reddit" [V phrasing, H demand].
8. **Confidential-conversation CTA** ("Currently employed? Text us; we won't call your shop"), because employed techs don't answer unknown calls [S HVAC practice].
9. **Workload receipts from the shop's own data**, published as medians with methodology, which no competitor does [H].
10. **CQE + Federal Bonding** remove negligent-hiring and theft risk for second-chance tire-tech hires [V ORC 2953.25, bonds4jobs].
11. **SkillBridge enrollment window opens Oct 1** for veterans finishing service (business must be 3+ yrs old; Nick's founded 2018) [V].
12. **Boomerang list:** past techs in the `technicians` table get a personal note when the offer improves [H].

## Verification (for the P0 code)
- `pnpm exec vitest run server/jobPostingLifecycle.test.ts server/candidates.test.ts` + new baseSalary and UA tests (each shown red before the fix).
- `pnpm run verify` from `apps/nickstire` (nickstire-verify skill); `pnpm run regen` via the workflow_dispatch prerender refresh (needs `GOOGLE_MAPS_API_KEY`).
- After deploy: `curl -A "Googlebot"` and `curl -A "<Indeed UA>"` on `/careers/automotive-technician` show baseSalary; `curl /careers/nope` -> 404; Google Rich Results Test on the 3 URLs; `node scripts/indexing-api-submit.mjs careers/<slug>`; one test application triggers the owner alert (flag on in a staging check only).
- Deliverable doc committed at `apps/nickstire/docs/recruiting/RECRUITING-ENGINE-2026-09.md` (this report) on branch `claude/funny-gates-asubwi`, draft PR opened.

## Sources (primary unless noted)
Google JobPosting docs (updated 2026-09-08) developers.google.com/search/docs/appearance/structured-data/job-posting | Indexing API quota developers.google.com/search/apis/indexing-api/v3/quota-pricing | Indeed single-source feed policy (2026-03-31) indeed.com/help/employers/articles/single-source-feed-policy-effective-march-31-2026 | HR Dive on Indeed crawl hrdive.com/news/visibility-ends-for-certain-free-single-source-xml-feeds-on-indeed/816209/ | Indeed pricing (2026-08-19) indeed.com/hire/resources/howtohub/how-pricing-works-on-indeed | Google Ads employment policy support.google.com/adspolicy/answer/9997418 | TikTok SAC ads.tiktok.com/help/article/list-of-targeting-restrictions-for-special-ad-categories | Tri-C employer jobs tri-c.edu/programs/automotive-technology/employer-job-openings.html | Tri-C Handshake tri-c.edu/career-services/employer-services/handshake.html | ASE acquires WrenchWay prnewswire.com (2026-06-30) | ASE Connects shops aseconnects.com/solutions/shops/ | Enterprise Euclid enterprisemobility.com/en/careers/job.html/522500 [S] | GCRTA riderta.com/events/2026/3/13/mechanics-hiring-event | USPS about.usps.com/newsroom/local-releases/oh/2025/0623 | BLS OEWS Cleveland | WrenchWay/ASE 2026 Voice of Technician via autobodynews (2026-03-10) [S] | TechForce supply/demand (May 2026) techforce.org/supplydemand | Ohio min wage com.ohio.gov | Encino Motorcars law.cornell.edu/supremecourt/text/16-1362 | DOL FS#20 | 29 CFR 531.35 | Cleveland pay transparency (Jackson Lewis) | ORC 2953.25 (CQE) | bonds4jobs.com | SkillBridge skillbridge.mil | TechCred development.ohio.gov/techcred | ApprenticeOhio | Greater Cleveland Works greaterclevelandworks.org/for-employers | FTC 16 CFR 255 | Cal.com closed-source cal.com/blog/cal-com-goes-closed-source-why | Resend inbound resend.com/docs/dashboard/receiving/introduction | Turnstile developers.cloudflare.com/turnstile | iCIMS referral retention [vendor] | SCCA NEOHIO neohioscca.com | Cars & Coffee Cleveland carsandcoffeecleveland.net.

---

## 15. Merge with the operator's second research pass (2026-09-23)

A second plan was pasted mid-build. Each factual claim was checked before adoption; the ideas that survived are folded in here. The framing it contributed is kept as the positioning rule:

> **High autonomy + high standards + low bureaucracy + plentiful straightforward work.** Never advertise "easy" or "less strict" - those read as low standards to an elite tech. Say "mostly profitable bread-and-butter work, less time fighting the system", and pair every freedom with a standard (torque spec, clean diagnosis, no hidden comebacks, clean bay).

### Claims verified / not verified

| Claim | Verdict | Source |
|---|---|---|
| ASE Education Foundation DOL registered-apprenticeship grant pays sponsors **$3,500 per apprentice** ($2,500 at 90 days + $1,000 at 9 months); shops without a program can get help building one | **[V]** - biggest item the first report missed | aseeducationfoundation.org/apprenticeship ; repairerdrivennews.com 2026-09-01 |
| Tri-C Automotive open house **Sat Oct 3, 2026**, 9-11am, Advanced Automotive Technology Center, Western Campus (Parma) | **[V]** date and place; it is a **prospective-student** open house (enrollment, costs, scholarships), so its hiring value is **[H]** - go to meet instructors, not applicants | events.tri-c.edu (live page ...-5841; the ...-2048 URL now 404s) |
| NE Ohio master techs are offered $40-50/hr | **[S] partly** - a Parma dealer posting "up to $45/hr" + $1,500 sign-on; ZipRecruiter national master-tech avg ~$37.54/hr. The locked $30.00-$37.50 matches Enterprise Euclid but sits **below the local top end for true masters**. | ziprecruiter.com (Parma listings, master-tech salary page) |
| WrenchWay/ASE 2026: 41% prefer hourly/salary + production bonus; 38% don't want weekends | **[S]** not re-fetched; consistent in direction with the 2025 numbers in Sec. 2 | autobodynews (2026-03-10) |
| /reviews page throws a dynamic-module error | **not reproduced** - the Googlebot view renders fully. A browser chunk-load error is plausible given Railway redeploys every few minutes; unconfirmed. | curl 2026-09-23 |

### Adopted (and where it now lives)

1. **Confidential lane** - "Already working somewhere? Talk privately first - no application." Built: hero link + form lane (`#talk`), owner alert marked CONFIDENTIAL / "contact discreetly".
2. **Conversation is the conversion unit**, not the application. Built: five intents (apply / talk privately / see the shop / keep me in mind / apprentice), stored in `candidates.intent`.
3. **"What would make you move?" self-selector** - proprietary market intelligence. Built: `candidates.moveReasons` chips.
4. **Talent Network / candidate liquidity.** Built: `talent_network` + `not_now` statuses and the `nextFollowUpAt` column. Target from the second pass, kept as the 90-day goal: ~150 known prospects -> ~15 warm -> ~4 A/master relationships -> ~3 apprentice prospects, at all times.
5. **Finer lifecycle** for source economics. Built: 17 statuses in `shared/candidateLifecycle.ts`; the SLA alarm watches the pre-contact set; `contactedAt` keeps the first stamp.
6. **Referral connector network** (tool-truck reps, parts reps, tow drivers, instructors, former employees). Built: admin link + QR generator (`/careers?ref=<code>`), `candidates.refCode`, by-source rollup.
7. **Instant alerts.** Built, per the operator's instruction: text to the operator's own mobile from the store line + owner email + applicant acknowledgement email.
8. **Apprentice farm system** (Level 0 helper -> tires/TPMS -> brakes -> alignment -> electrical/diag -> B -> A/diagnostic, each with checklist, mentor, raise trigger, ASE target). Owner/field work: enrol as a registered-apprenticeship sponsor via the ASE grant (Sec. 4 table) to collect the $3,500 per apprentice.
9. **After-hours private shop tour** and **quarterly "Wrench Night"** (diagnostic challenge, tool demos, pizza, discreet "talk privately" QR). Both **[H]** - run once, measure conversations per event, keep only if at least one qualified conversation results.
10. **Earnings calculator** built from Nick's real pay plan (40/45/50/55 productive hours -> $), later backed by the anonymized weekly production distribution. Same rule as Sec. 6: publish distributions only after reconciliation.

### Not adopted, with reasons

- **Docling resume parsing** - a Python service beside a Node stack, for 5-20 hires a year that the owner reads personally. Resume upload itself stays a P1 option (S3 + type/size check), no parser.
- **Activepieces / n8n** - the existing cron + sendNotification + sendSms already cover every flow built here.
- **"You are not working seven days because we're open seven days"** - strong line, but it is a schedule promise; publish only once the owner states the real tech schedule.
- **`/careers/workload` page** - same condition as Sec. 6; the invoice mirror (104-143 paid invoices/month) does not yet support "busiest shop".
- **Outbound resume databases (Indeed Smart Sourcing, ZipRecruiter, OhioMeansJobs)** - adopted as a *process* (one hour each morning, ten plausible profiles, log each contact) rather than code; OhioMeansJobs resume search is free, the others are paid.

## 16. What shipped in code (PR #2557)

- JobPosting carries `baseSalary` (auto tech $30.00-$37.50/hr, tire/hybrid $22.00-$25.50/hr, service advisor blank until the owner sets it), HTML description with requirements + hours, `experienceRequirements`, a PNG logo. Visible pay above the fold; a drift test pins route meta to the same numbers.
- Unknown or closed `/careers/<slug>` answers a real 404 (was a soft 200).
- Indeed crawler tokens (`indeedjobbot`, `indeedbot`) get prerendered HTML. Confirm they appear in Railway http logs; delete any that never fire.
- Candidate intake: owner text (store line -> operator mobile, internal class), owner email, applicant ack email. All three are ON; each stops only if its switch is set: `CANDIDATE_OWNER_ALERT=off` / `CANDIDATE_OWNER_SMS=off` / `CANDIDATE_ACK_EMAIL=off`.
- Five intents, move-reason chips, honeypot, E.164 repeat-applicant detection, gclid/utm_term/utm_content capture, referral codes, 17-status lifecycle, admin rollup + QR generator.
- `drizzle/0129` (hand-applied, nullable) with a pre-0129 fallback so nothing breaks before it is applied.

**Owner steps after merge:** apply 0129 - run the prerender refresh workflow - ping the Indexing API for the 3 job URLs - decide the service-advisor range and the real tech schedule - register for the Tri-C Oct 3 open house and the ASE apprenticeship program.

## 17. Post-deploy status and independent audit (2026-09-23)

**Live and verified in production**
- JobPosting with `baseSalary` on the auto-tech and tire-tech pages (prerender refresh 79983f9); service advisor shows "Discussed at interview". `/careers/<unknown>` = 404 for browsers and Googlebot. Indeed user agents get the prerendered page. IndexNow accepted 5 URLs; Indexing API `URL_UPDATED` returned 200 for all 3 jobs.
- Migration 0129 applied 2026-09-23 01:54Z. TiDB's DDL job log shows exactly 11 jobs for that run (ids 1089-1099: the 9 candidates columns and 2 indexes) - nothing else changed. The run also executed the list's `UPDATE shop_settings ... tireMarkup`, but that row still reads `value 100 / updatedAt 2026-06-18`, so it changed nothing; the statement is now removed from the list.
- Owner text from the store line reached the operator's mobile (live test candidates #1 and #2 - both test rows; mark them withdrew).
- **Owner and applicant emails do not deliver:** the Resend domain nickstire.org is unverified, so every email fails. Fix at the DNS host (Global Domain Group): TXT `resend._domainkey`, MX `send` -> `feedback-smtp.us-east-1.amazonses.com` (10), TXT `send` = `v=spf1 include:amazonses.com ~all`.

**Outage, disclosed:** #2557 deployed at ~01:19Z with an insert that named the 0129 columns before 0129 existed; every careers submission failed until #2561 at ~01:36Z (~17 minutes). The deploy's logs show exactly one `candidates.submit` in that window - the verification test itself - so no applicant was lost. The `candidates` table holds only the two test rows: **no real application has been saved since the table went live on 2026-09-09.**

**Three independent reviews (server, client/UX, SEO + claims) - what they found and what changed**
- **Owner text lost across a restart (fixed):** a text queued while the store phone was offline lost its "internal" intent when Railway restarted the app (every merge), and the internal-line guard then refused it until it was dead-lettered. The drain also held it until 8 AM. Now the replay intent comes from the destination (an internal line), which the durable row keeps; behavioural test drives the real queue timer.
- **"Owner only" was not true (fixed):** the confidential text named the person on the store phone, which staff can read; the email pushed its title into Railway logs. Now: the confidential text carries only the role and a candidate number, the email goes to the CEO inbox with no push, the applicant's reply goes to the owner, and the form says "goes straight to the owner". Note: the Candidates panel itself is visible to any admin role with leads access (front desk, manager) - restrict it if that matters.
- **Abuse brakes (new):** a public form that texts the owner and emails any typed address had only a 10/hour/IP limit, and internal texts count toward the shop-wide SMS cap. Now: no second owner text for the same phone within 24h, owner alerts stop at 20/day, applicant emails at 30/day and one per address per day - all counted from the table, so a restart does not reset them.
- **One-tap migrations card (fixed):** it said "re-running is safe" while the list could reset the tire markup. The reset is removed, a guard test keeps any settings write out of the list, and the card now shows "already in place" and failures separately.
- **Also fixed:** PII (name/phone/email) in the insert-failure log and in the email log; emails now render with line breaks; applicant greeting cannot carry free text; long ad URLs no longer reject an application; a two-number phone field no longer fails the save; positionTitle accepts only real job titles; lane buttons follow every tap; move-reason chips are only sent from lanes that show them; honeypot rows neither count as conversions nor file referral claims; calculator inputs, neutral defaults and "gross pay" wording; SEO descriptions match the prerendered pay-bearing ones; job pages get the site layout; `experienceRequirements` = "no requirements" where true; `datePosted` moved to 2026-09-23 for the two roles whose pay was published; the workload SQL parses on TiDB (the `lines` alias was reserved).

**Review standing, measured (read-only, 2026-09-23, workload-evidence.sql query 5):** at the 2026-09-22 snapshot Nick's leads every tracked place - 1,715 Google reviews vs Meineke Cleveland 1,381, Moe's Tire Center 653, Firestone (Euclid Ave) 501, the rest under 300. The six shops added on 2026-09-23 (Confident Tire among them, 1,530 on SureCritic, Google count unknown) get their first snapshot at the next daily run; **re-run query 5 after 2026-09-24 before any "most reviewed" wording.** The same probe found "Midas (Euclid Ave)" resolving to Nick's OWN listing for 45 snapshots - the monitor now skips any competitor that resolves to Nick's place_id, and query 5 drops the historical rows. A second "Firestone 26086 Euclid Ave" entry was removed before its first run: the existing Firestone entry most likely resolves to that same store.

**Still open (owner decisions or later work)**
- Keep the tire/hybrid floor at $22 (above Enterprise's $20) or change it - Sec. 12 correction.
- Service-advisor pay range; the real tech schedule (the page's "Sunday hours available" line predates this work); whether to publish a weekly guarantee and benefits - the Enterprise comparison is lost on those, not on the number.
- Never text STOP (or END, CANCEL, QUIT, UNSUBSCRIBE) from the operator's mobile to the shop line. The opt-out index reads every such inbound message ever logged (server/sms.ts), a later START does not clear that source, and the index also refuses internal texts - the careers alert would stop for good. (It is not the case today: the 2026-09-23 test texts were delivered.)
- `nextFollowUpAt` has no writer yet (the owner alert no longer tells anyone to set it).
