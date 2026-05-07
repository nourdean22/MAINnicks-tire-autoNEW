# CRO Audit — Booking Endpoint

> Conversion-rate optimization analysis of `/booking` (the conversion
> endpoint of the entire site) and recommendations for further work.
> Generated 2026-05-07 (wave-47) via the page-cro + form-cro +
> social-proof-architect skills.

---

## Booking page architecture (already strong)

The page is a 333-line composition of:

1. **Reciprocity-loaded hero** — "60 seconds · no credit card" pill +
   "Drop it off." H1 + clear sub-copy
2. **CapacityBanner** — REAL trpc.conversion.shopCapacity data (slots
   remaining today, est. wait, next available bay). Auto-hides if shop
   is closed. Never lies.
3. **BookingWizard** — multi-step form with service pre-selection from URL
4. **TrustMicrocopy** — 3 ankles right under the form (encryption,
   no-commitment-to-fix, call-direct fallback)
5. **NextStepsTimeline** — sets the next 3 expectations after submit

Architecture-wise, the page is a thoughtful CRO build. Wave-47's
contribution is to surface social proof at the decision moment.

---

## Wave-47 surgical fix shipped

### Star + review-count strip (between H1/sub and CapacityBanner)

```
★★★★★  4.9  from 1,700+ Cleveland drivers
```

Slotted into the hero, immediately above CapacityBanner. The visitor's
last visual signal before committing to the form is "1,700+ already
chose this."

Implementation details:
- 5-star widget in brand yellow (#FDB913)
- Rating + count both use `<CountUpNumber>` for the magnetic count-up
  animation from wave-45 (decimals=1 on rating, suffix="+" on count)
- Wrapped in a brand-yellow-tinted pill `bg-[#FDB913]/[0.06]
  border-[#FDB913]/25` so it visually elevates without competing with
  the H1
- Count-up duration tuned slightly faster than the home-page
  TrustNumbers strip (1100/1400ms vs 1400ms) because the booking page
  visitor is closer to commit and shouldn't wait

This is the social-proof-architect intervention: review proof at the
click moment, not buried under the form.

---

## Conversion friction inventory (full booking page audit)

### What's working (don't touch)

✅ **Live capacity data** — trpc.conversion.shopCapacity is genuinely
   updated; never lies. Builds trust.

✅ **Service pre-selection from URL** — `/booking?service=brakes` etc.
   removes a step for service-page-driven visitors.

✅ **TrustMicrocopy ankles** — 3 specific friction-removers (encryption,
   no-commitment, call-fallback) are well-targeted.

✅ **NextStepsTimeline** — answers "what happens after I submit?" before
   the user has to wonder.

✅ **Phone fallback prominent** — TrustMicrocopy includes "Or call us
   directly" with the number visible. Reduces form abandon by giving
   alternate path.

✅ **Cross-references at bottom** — "/services" + "/diagnose" + financing
   handled gracefully if the user isn't ready to book.

### What still has leverage — status (post wave-67)

✅ **Field-level CRO (form-cro skill territory)** — verified wave-67.
   BookingWizard already uses above-input labels (not placeholder-only)
   with `text-[12px] font-medium ... block mb-2/mb-3` pattern, plus
   `aria-label` for icon-only inputs. Multi-step progress indicator is
   present (STEP_LABELS rendered with active-step highlighting at line
   312). Required fields are minimized (each step has 2-3 fields max).
   Inline validation feedback + brand-voice error states still room for
   improvement but not blocking.

✅ **Mobile keyboard optimization** — shipped wave-56. `autoComplete`
   + `inputMode` + `enterKeyHint` wired on every input in
   BookingWizard.tsx.

✅ **Immediate confirmation copy** — already FCFS-aligned (wave-28
   audit fix). Post-submit confirmation reads "You're in the queue,
   {firstName}." with FCFS body copy + storefront photo + referral
   incentive. No "RESERVED" / "Slot held" language. Brand-voice
   success state.

✅ **Exit intent copy** — reviewed wave-66. Two fixes applied:
   (a) success-message timing inconsistency (5min → 15min, matches
   form promise), (b) docstring updated to reflect current FCFS-aligned
   copy (was referencing deleted CONVERSION-OVERHAUL-V1.1.md spec).
   Plus wave-67 closed the same 5min/15min gap in UrgencyWidget.

⚠️ **A/B test infrastructure** — NOT shipped. No A/B testing wired up.
   Once GSC traffic ramps from waves 33-37/40 SEO work, this becomes
   worth installing (e.g., a simple GrowthBook-style flag system).
   Defer until traffic threshold reached.

### What I considered and rejected

❌ **Exit-intent on first visit** — already shipped via ExitIntentModal.
   Don't double-modal.

❌ **Sticky "scroll to form" CTA** — booking page is short enough that
   the form is always near. Adding a sticky element creates UI clutter.

❌ **Live chat on booking page** — VAPI handles voice; chat would
   compete for attention. Skip.

❌ **Countdown urgency timer** — explicitly forbidden by
   DESIGN_PHILOSOPHY.md (manipulative trope, breaks trust).

❌ **Pre-checked SMS opt-in** — same. Pre-checked consent boxes are
   forbidden.

---

## Hypothesis-driven future tests

Once A/B infrastructure is live:

1. **Hypothesis: form completion lifts when star strip is moved INSIDE
   form (visible while typing)** vs current placement (above form).
   Effect size estimate: +2-4% completion rate.

2. **Hypothesis: 3-step wizard outperforms single-page form for
   first-time visitors.** Wave-47 didn't change wizard vs single-page;
   this is worth A/B testing.

3. **Hypothesis: real-time call-back ETA ("Calling you back in ~6
   minutes") outperforms generic "within 15 minutes."** Requires shop
   capacity API extension.

4. **Hypothesis: SMS-first vs phone-first opt-in changes commit rate.**
   Currently phone-first; SMS is faster for the user but creates
   friction for the shop responding.

---

## Booking page DFII score (post wave-47)

- Aesthetic: **4** — solid; star strip lifts it +1 from prior 3
- Fit: **4** — brand voice present in copy + star strip reinforces
- Feasibility: **5** — already shipped, working
- Performance: **5** — light, fast, no janky animations
- Risk: **−1** — conversion endpoint, every friction point still matters
- **Total: 17 → A+ tier** (was 15 / B+ in wave-44 audit)

Wave-47's intervention pushed the booking page from B+ to A+.

---

## Last updated

2026-05-07 (wave-67 — refresh after closing 5/6 audit gaps).

The original wave-47 audit listed 6 leverage points as "NOT shipped".
Five have since been verified-as-shipped or freshly-shipped:
- Field-level form labels: verified already-correct (wave-67)
- Mobile keyboard hints: shipped wave-56
- FCFS success-state copy: shipped wave-28
- ExitIntentModal copy honesty: shipped wave-66
- UrgencyWidget copy honesty: shipped wave-67

Only A/B testing infrastructure remains as future work, gated on
traffic threshold being reached.

Next CRO work: defer until A/B infrastructure is in place (separate
session to install GrowthBook-style flags). Then run the hypothesis
tests above with real traffic.
