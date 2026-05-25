# Visual Regression Testing Framework

**Skill port:** B11 · ui-visual-validator
**Applies to:** admin pages (LeadsBrief, MoneyBrief, OutreachBrief, CustomersBrief), customer-facing pages (Home, TireFinder, /brakes, /financing), statenour /scoreboard.
**Authored:** 2026-05-26.

## Why this doc exists

Unit tests catch logic. Type checks catch shape mismatches. NEITHER catches "the CSS shift accidentally hides the SCHEDULE DROP-OFF button on mobile." Those bugs only show up when an operator opens the page · which means real customers see them first.

Visual regression tests catch this class · snapshot the rendered page · compare to baseline · fail if pixels diverge beyond threshold.

## The 3-tier visual test suite

### Tier 1 · CRITICAL pages (block deploy on regression)

These pages are the customer journey. Any visual break is a SEV-2.

- `/` Home · hero block, CTAs, social-proof strip
- `/tires` TireFinder · search box, result tiles, ORDER button
- `/brakes` BrakeRepairPage · hero, price-anchor table, FAQ
- `/financing` FinancingPage · payment-plan tiles, application CTA
- `/booking` BookingPage · form, calendar widget
- Admin login page (PWA-critical)

Snapshot on 3 viewports · 375x667 (iPhone SE), 390x844 (iPhone 14), 1440x900 (desktop).
Threshold · 0.5% pixel diff allowed (anti-aliasing tolerance).
On fail · CI blocks deploy · operator reviews diff manually · either fixes OR accepts new baseline.

### Tier 2 · OPERATOR pages (warning · not blocking)

These pages are admin-facing. Visual regressions are annoying but not customer-impacting.

- Admin LeadsSection · column widths, badge colors
- Admin Today page / MorningBrief · tile layout
- Admin /money · revenue tiles
- Admin /voice · call list
- statenour /scoreboard · NickHealthSection

Snapshot on 1 viewport · 1440x900 desktop only.
Threshold · 2% pixel diff allowed.
On fail · CI passes with warning · operator gets Telegram nudge to review diff.

### Tier 3 · INTERNAL pages (sample on PR · log only)

Internal-only surfaces where regressions are cosmetic.

- statenour /journal · /brain · /tasks
- Admin SmsConversationsSection
- Admin CronDiagnosticsSection
- Admin SystemSection

Snapshot weekly · diff posted to a Telegram thread · no blocking behavior.

## Test infrastructure shape

Each test is a Playwright/Vitest test that:

```typescript
test("Home hero · 390x844 (iPhone 14)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://nickstire.org/");
  await page.waitForSelector("h1");
  await expect(page).toHaveScreenshot("home-hero-iphone14.png", {
    fullPage: false,
    maxDiffPixelRatio: 0.005,  // 0.5%
    threshold: 0.2,
    animations: "disabled",
  });
});
```

Baselines live in `apps/nickstire/tests/visual/__snapshots__/`. First run captures · subsequent runs diff.

## When baselines drift legitimately

CSS changes are SUPPOSED to break visual baselines. The flow:

1. Operator/dev makes a CSS change
2. PR runs visual tests · fails on Tier-1 page
3. Operator reviews the diff in PR · "yes, this is the intended change · the SCHEDULE DROP-OFF button is now bigger"
4. PR updates baseline · `npm run test:visual -- --update-snapshots` · commits new baseline alongside CSS change
5. Future runs diff against the new baseline

Reviewing the diff IS the gate · not blindly updating snapshots. If the diff has UNINTENDED changes (a different button moved by 4px because flexbox), catch it here.

## Anti-patterns

### "Snapshot everything"

100 snapshots per PR · all of them fail when global CSS changes · no one reviews them · everyone updates baselines blindly · regressions sneak in. Pick the 6-10 CRITICAL pages.

### "Snapshot dynamic content"

Snapshotting a page with live "5 minutes ago" timestamps fails every run. Mock the data layer or freeze time before snapshotting.

### "Threshold-too-loose"

5% threshold means a button moving 20px diagonally still passes. Tier-1 must be ≤0.5%. Tier-2 ≤2%. Anything looser is theater.

### "Snapshot ONE viewport"

Mobile + desktop have different bugs. Per Wave O hero band · the bug was MOBILE-only. Snapshot at least 2 viewports for any customer-facing page.

## Implementation plan (queued)

1. Add `@playwright/test` if not already · install browsers (chromium · webkit)
2. Create `tests/visual/` directory · structure by page
3. Write 6 Tier-1 tests · 3 viewports each = 18 snapshots
4. Capture baselines on a known-good commit (post Wave Z would be ideal)
5. Add `visual-test` step to CI · runs on PRs · blocks Tier-1 fails
6. Wire to Telegram for Tier-2 warnings
7. Weekly cron for Tier-3 sampling

## Anti-anti-pattern · DO use this for the prerender problem

The 2026-05-24 prerender incident would have been caught by a visual regression test on `/` post-deploy. The page rendered as "no styles" · pixel diff vs baseline would have been MASSIVE.

Adding a single Tier-1 visual test on Home is the cheapest possible defense against that class of bug. Pre-flight asset-reference test (per the postmortem in Wave T) + visual regression test = belt-and-suspenders.

## Skill-port lineage

B11 from the audit's Round 2. Companion to:
- Wave T · postmortem (prerender incident would have been caught by this)
- Wave M · modulepreload PSI win · visual test would have caught if the cleanup broke layout
- B2 · SLOs · visual breakage is a Tier-S SLO breach

Future · screenshot diffs go into Telegram thread per Tier-2 · operator scrolls through 6-8 snapshots in 30 seconds vs a 45-minute UI audit. The format compresses operator-attention.
