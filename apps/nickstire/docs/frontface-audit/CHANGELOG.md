# Front-facing site audit — operator changelog (wave-183, 2026-06-03)

Audited every public nickstire.org page (~90 routes, 9-agent read-only fan-out) for visual + copy + data + SEO uniformity. 3 waves shipped to `main`, each build-green + tsc 0 + brand-voice 0.

## ✅ Shipped (live on main)

### Wave-1 `66d5fda6` — truth + tire pricing
- **Killed a false 3-year warranty.** The site, the **AI chatbot**, the GBP/Instagram generators, and the public AI-crawler files (`ai.txt`, `llms-full.txt` excluded for reword, `business-data.json`, `services-schema.json`) all claimed a **"36-month / 36,000-mile" warranty**. Real warranty is **12-month / 12,000-mile** — corrected everywhere (~30 spots). Left the *legit* 36-month battery free-replacement warranty alone.
- **Fixed false founding claims:** "Since 2005" (Landing page) and "served Cleveland for over 20 years" + "1,688 reviews" (Women's-safety page) → real **2018 / 1,700+**.
- **Fixed a live geo bug:** the prerender patcher was silently reverting your Google-pinned map coordinates back to wrong ones on every run (hurts Local-Pack ranking) — removed.
- **Tire pricing = your decoy strategy, now uniform everywhere + on Google:**
  - **Used tires → "from $25 installed"** headline + fine print *"12-inch rims, subject to availability"* + honest band *"most sizes $40-80"*. Swept ~45 pages + the Google schema. (Was a contradictory $40-vs-$60 mess.)
  - **New tires → "from $89 installed"** + *"Any tire, any brand. Nick never says no"* positioning (no ™). (Was $60-vs-$80.)
  - Centralized both in `business.ts` so they can never drift again.
  - Fixed a stray "$40 down / $80 down" financing bug → your real **$10 down**.
- Brand voice: "family-owned"→"family-run", dropped "trusted/quality/premium/inspection" kill-words on touched lines. Fixed an undefined CSS color token (Specials/Referral hero glow was rendering invisible).

### Wave-2 `c0e190e0` — brand-voice + SEO/link/visual
- "family-owned" → "family-run" on the **/about + /careers** Google descriptions + the homepage TrustStrip chip (also killed its duplicate "1,700+ reviews" label).
- NotificationBar self-praise "drivers trust Nick's" → concrete (kept the genuine customer review that says "trust").
- DiagnosticsPage `<title>` was missing the "| Nick's" suffix every sibling has → added.
- PriceEstimator breadcrumb was feeding Google a wrong leaf URL (`/estimate` vs the real `/pricing`) → fixed.
- StatusTracker card had dead conflicting `rounded-2xl rounded-lg` → fixed.

### Wave-3 `15c47e10` — dead links
- The competitor-roundup tiles built links from a formula that 404'd for **4 of 7** (firestone/monro/big-o/ntb — their routes break the naming pattern). Replaced with an explicit route map.

### Wave-4 `aa6e69d0` — chrome + off-palette tokenization
- **BookingPage** (external GMB/Google links land here) had no nav/footer -> wrapped in the shared PageLayout. CustomerPortal (phone-auth portal app-shell) + LandingPage (conversion LP) left chrome-less on purpose — marketing chrome would be wrong there.
- **DiagnosePage / SharePage / TrackJob / WomensSafety** hardcoded hex/gray -> design tokens (~145 classes). Zero-shift on the exact-match hexes (#0A0A0A=background, #141414=card, #FDB913=primary, #A0A0A0=muted-foreground); gray-*/yellow-400 -> closest brand token. TrackJob colors-only (kept its minimal status-page chrome).

### Wave-5 `6df2ebda` -> `838c1968` — channel pricing (the $25 -> $60 call)
- Briefly propagated the $25 decoy to all quoting channels (`6df2ebda`), then **reverted them to $60** (`838c1968`) on your call: phone/SMS/voice/chatbot/IG reach high-intent callers (often sending tow trucks) who need the real average, not a decoy that'd burn them at the counter. The **$25 stays on the website** (browsers shop with the fine print) + its crawler layer.
- New tires **$89** on channels; the AI price-validator + SMS-corpus prompts updated so they don't reject the new copy. **VAPI re-deployed live at $60** (PATCH 200, transfer number preserved). GBP held.

## 🟡 Needs your call / deferred (NOT shipped)
- **Phone/SMS/Instagram/voice still quote "$60 used".** Your *site* now says $25, but the **VAPI receptionist, SMS campaigns, IG autopost, and the AI price-compliance validator** still encode $60. I did NOT change these — voice/SMS have no fine print, so quoting a flat "$25" to a caller is the bait-and-switch risk the review warned about. **Decision needed:** propagate $25 to those channels (and how — flat $25, or "$25-80 range"?), or keep them at $60. **-> RESOLVED in Wave-5: channels reverted to $60 (high-intent / tow-truck audience), site keeps the $25 decoy, VAPI re-deployed live.**
- **Chrome:** TrackJob / BookingPage / CustomerPortal / LandingPage don't use the shared nav+footer. Some may be intentional (deep-linked status pages, focused booking). Resolved in wave-4 (`aa6e69d0`): BookingPage wrapped; CustomerPortal + LandingPage intentionally left chrome-less.
- **Off-palette pages** (DiagnosePage, SharePage, TrackJob, WomensSafety) use hardcoded hex/gray instead of the design tokens — low visual impact (already dark-consistent), code-hygiene. DONE in wave-4 (`aa6e69d0`).
- **Prerendered HTML** (`prerendered/*.html`) still shows old prices/warranty until a full `pnpm run prerender` regen (Puppeteer is broken on the Windows box; the weekly Linux CI regen will refresh it — the live hydrated site is already correct).
- Trivial: SundayMuffler "free inspection"→"free check"; a couple "30+ years experience" lines (defensible as team-combined).
