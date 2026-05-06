# Real-Device QA Checklist

**Purpose:** Bridge the gap between automated tests (tsc + voice-compliance + Lighthouse) and what customers actually see on their devices. Run this before every meaningful production push, and once a month against live prod regardless of pushes.

**Time required:** 20-30 minutes for full pass. 10 minutes for targeted spot-check.

---

## Devices to test

Pick at least 1 from each tier. Cleveland customer base skews older Android + iPhone in roughly equal mix.

| Tier | Device example | Why |
|---|---|---|
| Mid-2020s iPhone | iPhone 13/14/15 | Default Apple traffic |
| Mid-2020s Android | Samsung Galaxy S22+ | Default high-end Android |
| **Older Android** | Galaxy S8/S9, Moto G | **Most-likely worst case** in Cleveland working class |
| Tablet | iPad / iPad mini | Used by older customers |
| Desktop | MacBook + Chrome | Owner / admin sessions |

Bonus: test on a spotty 4G connection if possible (chrome devtools throttle to "Slow 4G" replicates this).

---

## Page coverage — minimum

- `/` (Home) — most-traffic page
- `/services` — biggest CTR opportunity per GSC
- `/brakes` — typical FocusedServicePage
- `/cleveland-auto-repair` — typical city page
- `/booking` — primary conversion page
- `/financing` — payment flow

Bonus: any page from the latest commit's diff.

---

## What to check on every page

### Above-the-fold (hero)

- [ ] H1 readable in ≤2 seconds (no janky letter-stamp animation lag)
- [ ] Hero photo loaded — no broken-image icon, no layout shift on load
- [ ] Subhead body copy fully visible without horizontal scroll
- [ ] Primary CTA (Call / Book) tappable with thumb without zooming
- [ ] Secondary CTA (Hold a Bay / Drop Off) tappable
- [ ] No text overlapping with the photo gradient
- [ ] LCP feels under 2.5s (if it feels slow, run Lighthouse)

### Mid-page

- [ ] PhotoRibbon scrolls horizontally with thumb swipe (no fight with vertical scroll)
- [ ] Photo captions readable
- [ ] Stats numerals (4.9★, 1,700+) render with letterpress shadow visible
- [ ] Service tiles render with proper aspect ratio (no squashing)
- [ ] CSS-only spinning tire decoration doesn't cause stutter on scroll (Galaxy S8 specifically)
- [ ] Section parallax-rise effect doesn't fight scroll (test by scrolling fast)

### Sticky elements

- [ ] StickyMobileCTA appears after ~600px of scroll
- [ ] Glassmorphic blur looks correct (not solid black, not transparent)
- [ ] Yellow accent hairline visible above the bar
- [ ] Both CTAs (Call + Hold a Bay) tappable with thumb
- [ ] ScrollProgressBar fills with yellow as you scroll
- [ ] Rolling tire icon visible on tablet/desktop, hidden on phone

### Conversion paths

- [ ] Tap Call CTA → phone dialer opens with right number
- [ ] Tap Drop Off / Hold a Bay → /booking loads, form rendered
- [ ] Booking form: type a name, type a phone, pick a service — all inputs work without zoom-on-focus annoyance on Safari
- [ ] No "form covered by mobile keyboard" issue when filling fields
- [ ] Submit shows loading state (TireSpinner or similar), then confirmation

### Visual polish

- [ ] No overlapping text on any breakpoint
- [ ] No horizontal scroll on any page
- [ ] Yellow #FDB913 looks correctly saturated (not muddy)
- [ ] Photos don't appear stretched or cropped weirdly
- [ ] Skyline silhouette divider visible between sections
- [ ] Halftone dot texture visible but subtle on dark sections (Drop-Off Flywheel)

### Reduced-motion preference

If you can: enable iOS Settings → Accessibility → Motion → Reduce Motion. Then:

- [ ] Letter-stamp animation disabled (H1 just appears)
- [ ] Ken Burns drift disabled on hero photo
- [ ] PhotoRibbon entrance animations disabled
- [ ] CSS tire still renders but doesn't spin
- [ ] Parallax-rise sections appear without drift

### Save-Data preference (Android Chrome → Data Saver)

- [ ] HeroDustLayer canvas particles disabled (no animated dust)
- [ ] Other animations either reduced or disabled
- [ ] Page still functional and readable

---

## Things that have failed historically

These are specific regressions caught in past sessions. Re-test each every push:

- [ ] **CLS bounce on PhotoRibbon load** — images now declare width=1200 height=800. Confirm no layout jump on mid-tier Android.
- [ ] **24-hour HTML cache stickiness** — fixed 2026-05-06 via `max-age=300` on index.html fallthrough. Confirm new copy lands within 5 min of deploy.
- [ ] **Backdrop-filter stutter on sticky CTA** — reduced from blur(20) to blur(12) on 2026-05-06. Confirm Galaxy S8-era devices don't stutter when scrolling-up triggers the bar.
- [ ] **Mobile blog post horizontal scroll** — long tables in older blog posts can extend past viewport. Spot-check 1-2 blog posts.
- [ ] **Cybertruck hero photo on iOS Safari** — earlier issue with WebP rendering on older iOS. Confirm photo loads (not blank).

---

## What to do when something breaks

1. **Screenshot it.** With device + browser + URL visible.
2. **Note the build hash.** Top-right → Inspect → look for build version, OR git rev-parse HEAD on the deployed branch.
3. **File it as an issue or commit it as a bug fix.** Don't wait — these regressions compound.
4. **Run the tsc + voice-compliance suite locally** before re-deploying any fix.

---

## Cadence

| Trigger | Coverage |
|---|---|
| After any deploy with code changes (not config) | Targeted spot-check (10 min) — Home + 1 service page + booking flow |
| Weekly | Full pass (20-30 min) |
| Before pushing a major copy/visual wave | Full pass + specific pages touched |
| Monthly | Full pass + Lighthouse audit + GSC report cross-reference |

---

## Notes for remote sessions

When QA needs to happen but only a phone is available (CEO mode):

- Open `https://nickstire.org` in mobile Chrome
- Manually test the 6 key pages above
- Use Chrome devtools (request desktop site → enable inspector via menu) for any visual debugging
- For deeper Lighthouse data: `https://pagespeed.web.dev/?url=https://nickstire.org` — runs the full audit in the cloud

---

Last updated: 2026-05-06
Maintainer: NOUR OS / Nick's Tire & Auto

If this checklist gets stale, the engineering team should rotate it as part of the release-process audit.
