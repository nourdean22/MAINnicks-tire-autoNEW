# Admin coverage — every section, with a decision

**2026-09-07.** Ref: `origin/main` @ `195c496dd` (= the deployed commit, verified
via `/api/health` → `deploy.commit`). Companion to the Phase 1 work on branch
`nickstire/admin-queue-retire-sales-contract`.

**What this is.** The inventory the Phase 1 slices deliberately did not attempt:
every admin section, what it is for, who uses it, and a KEEP / REPAIR / MERGE /
MOVE / RETIRE decision. It exists so Phase 1 cannot be mistaken for "the admin is
done" — it is truth, reliability and the sales surface, not the whole product.

**What this is NOT.** It is not a mandate to rebuild every section. Most rows are
KEEP, and that is the correct outcome for a working admin. A verdict here is a
proposal with its evidence attached; none of it is authorized work.

**Honesty rule applied throughout.** A section I did not open is marked
`NOT AUDITED`, not given a confident verdict. Line counts and distinct tRPC call
counts are measured; everything else is either cited or labelled as an opinion.
Filling a table is not the same as knowing something.

---

## The table

Size = lines in the section's own entry component (not its subtree). tRPC = distinct
procedures called from that file. Both are rough proxies for surface area, useful
for spotting outliers and nothing more.

| Section (label) | Group | Size / tRPC | Primary user | Decision | Evidence |
|---|---|---|---|---|---|
| `overview` **Today** | Daily | 603 / 11 | Owner | **REPAIR — done in Phase 1** | Carried no revenue figure at all; opened with a 227-item queue; summary counts sat 7th, below a panel last measured 2026-06-07. Sales card added, reading order fixed. |
| `opportunities` **Opportunities** | Daily | 143 / 2 | Staff | **KEEP — new in Phase 1** | The retired Decision Inbox's data, off the owner's home. First UI consumer of `opportunityQueue.list`, which had no mount anywhere. |
| `approvals` **Approvals** | Daily | 370 / 6 | Owner + manager | **KEEP** | Trust-ladder queue; every AI-originated action lands here as a draft and executes on human approval, server-enforced in `services/proposals.ts`. This is the sanctioned consent surface — do not dilute it. |
| `customers` **Customers** | Daily | 188 / 0 | Staff + tech | **NOT AUDITED** | 188 lines with zero direct tRPC calls means the work is in child components; the parent is a shell. Customer/vehicle/conversation history is a named Phase 2 concern and needs its own pass, not a guess from a line count. |
| `leads` **Sales Pipeline** | Daily | 769 / 5 | Staff | **NOT AUDITED** | Second-largest Daily section. `leads` holds **2 rows for all time** (measured 2026-07-20, `todayPulse` header) — a 769-line surface over a near-empty table is the single strongest MERGE/RETIRE candidate in the admin, but that is a hypothesis until someone opens it. |
| `revenue` **Money** | Daily | 107 / 0 | Owner + **accountant** | **REPAIR** | Shell over `money/`. Its Shop Pulse tile rendered `$0` + `0% of pace` on a failed read — half-fixed in Phase 1 (`admin-stats` now reports `shopFloor` as unavailable); the CONSUMER still needs to render that as unknown. Second competing revenue pace lives here. |
| `memberships` **Nonstop Nick** | Daily | 217 / 2 | Owner + **accountant** | **HOLD — do not merge** | The 2026-09-01 thesis recommended MERGE into Customers and then held it: it removes `accountant`'s only door. Operator call, still open. Procedure-side it resolves to `money.view`, which accountant holds — so the loss would be purely navigational. |
| `tireOrders` **Tires** | Daily | 911 / 6 | Staff + tech | **NOT AUDITED** | **Largest Daily section.** No supplier API exists; `tireOrders.status = "ordered"` is set by a human with no actor or timestamp (audit F-19). Worth a pass on that alone. |
| `growth` **Marketing / Growth** | Reach | 763 / 10 | Owner | **NOT AUDITED** | Ten distinct procedures in one section. |
| `content` **Website & Local** | Reach | 73 / 0 | Owner | **NOT AUDITED** | Thin shell. |
| `instagram` **Instagram** | Reach | 384 KB subtree | Owner | **KEEP — highest risk** | Promoted out of Growth 2026-07-19 because it is "the surface that autonomously spends money and posts to a live audience". `IG_AUTOPOST_DRYRUN=false` verified live 2026-09-07: it publishes unattended and authors its own content. |
| `campaigns` **Outreach** | Reach | 131 / 0 (284 KB subtree) | Owner + manager | **KEEP** | Seven tabs: Messages, Campaigns, **Follow-Ups**, Reviews, Win-Back, Performance, Orchestrator. Note the name collision this caused — the new queue surface is `Opportunities`, not "Follow-ups", deliberately. |
| `voiceReceptionist` **Voice Receptionist** | Automation | 886 / 8 | Owner + staff | **NOT AUDITED** | Third-largest section. Calls are "the only thing in this database that is live to the minute" (`todayPulse`). |
| `intelligence` **Intelligence HQ** | Automation | 264 / 1 | Owner + manager + **viewer** | **REPAIR — partly done** | The thesis names this **the cautionary example** of dashboard sprawl: "reads that could live on Today, given a room of their own." Phase 1 fixed its worst lie (a total engine outage reported health 50/100 and "systems nominal"); the consumer must now render `scoreReliable`. MERGE-into-Today remains a live proposal. |
| `callTrackingView` **Call Tracking** | Automation | 447 / 4 | Staff | **NOT AUDITED** | Gained a sidebar door in the 2026-09-01 wave (was alias-only). |
| `opsHub` **Reports** | Truth | 215 / 2 | Owner + **accountant** + **viewer** | **NOT AUDITED** | One of only two sections reaching the read-only roles. |
| `trafficFunnel` **Traffic → Revenue** | Truth | 984 / 10 | Owner + manager | **NOT AUDITED** | **Largest section in the admin.** Lost `accountant` on 2026-09-02 after 7 of 10 procedure calls threw FORBIDDEN — the precedent for why a role grant must be diffed on BOTH gates. |
| `settings` **Settings / Safety** | System | 406 / 5 | Owner + manager | **KEEP** | Kill switches and safety flags. Do not consolidate a safety surface for tidiness. |
| `/admin/ad-studio` | out of shell | — | Owner | **MOVE (proposed)** | The thesis lists "Ad Studio in the shell" as still open. Three studios (`ad`, `ig`, `reel`) live outside the registry and are reachable only from header links. |
| `/admin/ig-studio`, `/admin/reel-studio` | out of shell | — | Owner | **NOT AUDITED** | Same class as above. |

**Counts:** 18 registry sections + 3 out-of-shell pages. 5 KEEP · 3 REPAIR
(2 begun in Phase 1) · 1 HOLD · 1 MOVE proposed · **10 NOT AUDITED** · 0 RETIRE.

Zero RETIRE verdicts is itself a finding: nothing in this admin is obviously
dead, and the subtraction the 2026-09-01 thesis calls for is about MERGING
overlapping surfaces, not deleting unused ones.

---

## Two rules that govern any consolidation here

**1. Role access is enforced on two gates, and only one is real.**
`allowedRoles` in `registry.tsx` is COSMETIC; `permissionForAdminProcedure` in
`shared/adminPermissions.ts` is the real one, and there is no server-side
boundary at a URL. Any move must diff BOTH, per role, before and after. The
`trafficFunnel` line above is what happens when only the cosmetic gate changes:
the role got a door it could not walk through.

**2. Mutations fail closed to `security.manage` (owner-only); queries fail open
to `admin.view`.** A merged page inherits the union of its children's procedure
requirements, which is how a merge silently locks a role out of work it used to
do.

---

## What Phase 1 did NOT cover, stated plainly

- **Visual review.** The authenticated admin cannot be rendered outside a
  deployed, signed-in browser (OAuth). Component behaviour is covered by render
  tests; layout, spacing and phone ergonomics are **not verified**. This is an
  operator step after deploy.
- **Customer / vehicle / conversation history** — named as a Phase 2 concern and
  not touched.
- **Images and static posts.** Phase 1 is reels only. `igAutopost` is the image
  lane, it publishes unattended, and it is **not** covered by the reel approval
  gate — by design, but it means "the media system is safe" would be false.
- **Media library reuse** — finding an approved asset, adapting it, assembling
  and scheduling without rediscovering the pipeline. Untouched.
- **A cheaper provider than Higgsfield.** No comparison was run. `REEL_VIDEO_PROVIDER`
  is pinned to `higgsfield` (verified live 2026-09-07). Any comparison must use
  real Nick's briefs and measure cost per APPROVED finished reel — including
  rejected attempts and human correction time — not cost per generated second.
- **Recovery ledger against real data.** The module is read-only and safe to run;
  no run is claimed.
