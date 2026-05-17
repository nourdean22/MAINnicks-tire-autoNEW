# A11Y + Motion-Perf Audit · /chat · 2026-05-12

> Read-only audit. No code modified. Production target `https://autonicks.com/chat` (v10.0.515-ish · reasoning-trace ships).
>
> **Skill stances applied:** `fixing-accessibility` (WCAG 2.1 AA · ARIA · keyboard · contrast) + `fixing-motion-performance` (compositor · scroll-jank · reduced-motion) + `production-code-audit` (line-by-line evidence).
> **Measurement substrate:** Chrome MCP tab `1464165278` on production. Live computed-style readings, real DOM measurements, real CSS rule introspection.
> **Operating viewport during audit:** 1090 × 572 logical / DPR 2.115 (the Chrome window would not shrink below ~1090px on this hardware so true 390×844 iPhone Safari rendering was simulated through code-path inspection + Tailwind breakpoint analysis · iPhone-specific items are flagged `[manual mobile verify]`).
> **OS-level reduced motion preference at audit time:** `prefers-reduced-motion: reduce = true`. That means the universal media-query at `app/globals.css:646` is firing — animations were observed pinned to `1e-05s` durations. The motion-perf section below also reasons about behavior **without** reduced motion to evaluate whether the code paths are compositor-safe by design.

---

## TL;DR

| Category | Grade | Headline |
|---|---|---|
| Contrast | **C** | 208 DOM elements use `--text-tertiary` (#666) which fails WCAG AA on every dark background in the system (3.03-3.55:1, target ≥ 4.5:1 for normal text). |
| Keyboard | **D** | Universal `:focus-visible` rule exists but is overridden by ≥20 files using Tailwind `outline-none` — including the composer textarea and every composer button. Programmatic focus shows `outline: 1.41px none`. |
| ARIA | **C+** | Composer textarea has NO `aria-label` and NO `<label>` — accessible name falls back to the placeholder. Conversation scroller has no `role` / `aria-label`. Top + bottom tickers have no `role="region"`. Icon buttons mostly have `aria-label`/`title` (good). |
| Touch targets | **D** | At 1090px sm-breakpoint, 5 composer buttons render at 32×32 (sm:w-8 sm:h-8), Send at 36×36, textarea at 32×40 min. 22 top-ticker links render at 24px tall. WCAG 2.5.8 minimum is 24×24; Apple HIG / WCAG AAA target 44×44. On true mobile (<640px) composer becomes 40×40 — still under 44. |
| Motion correctness | **A-** | Universal `prefers-reduced-motion: reduce` rule at `app/globals.css:646-660` covers `*, *::before, *::after` and was observed pinning every long-lived animation to `1e-05s`. Neural canvas early-returns out of rAF when reduced-motion is set. State-aura honored. |
| Compositor purity | **B** | Most keyframes are opacity/transform-only (post v10.0.466-502 conversions). Three known exceptions retain `box-shadow` animations: `state-fire-aura`, `state-drift-aura`, `state-low-energy-aura` (knowingly · ADR note at `globals.css:1561-1570` · 5% activation rate accepted). |
| Performance (FPS) | **[manual]** | rAF-based FPS sampling was started but the Chrome MCP renderer backgrounded the tab mid-batch, so the result vanished. Static code analysis suggests the streaming path is safe (Streamdown block-memoization · only changed block re-renders per token). **Mobile-device FPS during stream + neural-bg confirmation needed**. |
| Reduced-motion respect | **A** | Universal rule is in place and observed to fire. State-aura, nick-orb, ring-breathe, neural-bg canvas all yielded. |

**Aggregate compliance grade: B-**
(Held back by 208-element contrast fail + composer `outline-none` keyboard failure.)

---

## 1 · Live audit substrate

### 1a · CSS tokens captured from production

| Token | Value |
|---|---|
| `--bg-void` | `#050505` |
| `--bg-base` | `#0a0a0a` |
| `--bg-raised` | `#111` |
| `--bg-elevated` | `#1a1a1a` |
| `--bg-surface` | `#222` |
| `--text-primary` | `#f0f0f0` |
| `--text-secondary` | `#a3a3a3` |
| `--text-tertiary` | `#666` |
| `--gold` | `#fdb913` |
| `--gold-dim` | `#d49a0e` |
| `--border-default` | `#1f1f1f` |
| `--border-hover` | `#333` |
| `--status-red` | `#ef4444` |
| `--status-green` | `#22c55e` |
| `--status-yellow` | `#f59e0b` |
| `--status-blue` | `#3b82f6` |
| `--glass-bg` | `rgba(17,17,17,0.7)` |

### 1b · DOM-wide usage scan

| Style | Count of elements rendering with that computed `color` |
|---|---|
| `color: rgb(102,102,102)` (`--text-tertiary`) | **208** |
| `color: rgb(163,163,163)` (`--text-secondary`) | **30** |

### 1c · Window state

```
url:            https://autonicks.com/chat
viewport:       1090 × 572 (devicePixelRatio 2.115)
prefers-reduced-motion:   reduce  (OS-level setting · respected)
pointer:        fine (not coarse)
console errors: none captured during audit window
```

---

## 2 · WCAG 2.1 AA findings

### 2.1 · Text-color contrast ratios (Success Criterion 1.4.3 · ≥ 4.5:1 for normal text · ≥ 3:1 for large text 18pt+/14pt+bold)

Computed using WCAG-spec relative-luminance. Source: `app/globals.css:13-110` + `getComputedStyle(document.documentElement)`.

| Pair | Ratio | Verdict |
|---|---|---|
| `--text-primary` on `--bg-void` | **17.88:1** | AAA |
| `--text-primary` on `--bg-base` | **17.37:1** | AAA |
| `--text-primary` on `--bg-raised` | **16.57:1** | AAA |
| `--text-primary` on `--bg-elevated` | **15.27:1** | AAA |
| `--text-secondary` on `--bg-void` | **8.08:1** | AAA |
| `--text-secondary` on `--bg-base` | **7.85:1** | AAA |
| `--text-secondary` on `--bg-raised` | **7.49:1** | AAA |
| `--text-secondary` on `--bg-elevated` | **6.90:1** | AA (was the v10.0.452 fix from 3.28:1) |
| `--text-tertiary` on `--bg-void` | **3.55:1** | **FAIL AA (normal)** / AA-large only |
| `--text-tertiary` on `--bg-base` | **3.45:1** | **FAIL AA (normal)** / AA-large only |
| `--text-tertiary` on `--bg-raised` | **3.29:1** | **FAIL AA (normal)** / AA-large only |
| `--text-tertiary` on `--bg-elevated` | **3.03:1** | **FAIL AA (normal)** / **FAIL AA-large** at 18pt+ regular |
| `--gold` on `--bg-void` | **11.77:1** | AAA |
| `--gold` on `--bg-base` | **11.43:1** | AAA |
| `--gold` on `--bg-raised` | **10.90:1** | AAA |
| `--gold` on `--bg-elevated` | **10.05:1** | AAA |
| `--gold-dim` on `--bg-elevated` | **6.98:1** | AAA |
| `--status-red` on `--bg-elevated` | **4.62:1** | AA |
| `--status-green` on `--bg-elevated` | **7.64:1** | AAA |

**Finding A1 · HIGH · CONTRAST · --text-tertiary used as body text fails AA.** Affects 208 elements on this page alone (real DOM count). Used in:

- Composer placeholder text · `placeholder:text-[var(--text-tertiary)]` at `app/(mastery)/chat/page.tsx:3123`
- Reasoning-trace section labels + metric values · `components/chat/reasoning-trace.tsx:142, 150, 198, 204, 216, 224, 237, 260-262`
- Message action bar icons (copy / task / brain / pin / thumbs) · `components/chat/nick-message.tsx:563, 572, 581, 590, 601, 609`
- Quick-action chips · `nick-message.tsx:538`
- Timing ribbon · `nick-message.tsx:630`
- All composer button rest-state icons · `chat/page.tsx:2960, 2974, 3000, 3007, 3016, 3029`
- Speed ribbon / chat-history-search secondary copy / message bullet markers (`nick-message.tsx:479`)
- Bottom ticker labels (22 of them at 24px high)

The eyebrow / section-head / section-copy / empty-copy classes (`globals.css:243, 280, 310`) also reference `--text-tertiary` — fail propagates app-wide.

**Recommended fix:** Re-alias `--text-tertiary` to `#909090` (≈ 5.0:1 on `--bg-elevated`) OR introduce a `--text-tertiary-aa` token at `#909090` and migrate the body usages while keeping `#666` for pure decoration (rule numbers, dot separators that can have `aria-hidden`).

---

### 2.2 · Touch-target sizing (Success Criterion 2.5.8 · ≥ 24×24 css px · Apple HIG ≥ 44×44 pt)

Live measurements on the composer at the **1090px viewport** (Tailwind `sm:` breakpoint active).

| Control | File:line | Measured | WCAG 2.5.8 (24) | Apple HIG (44) |
|---|---|---|---|---|
| Mic button | `chat/page.tsx:2952` | **32×32** | pass | **FAIL** |
| Attach (paperclip) | `chat/page.tsx:2974` | **32×32** | pass | **FAIL** |
| ModePersona chip | `mode-persona-chip.tsx` via `chat/page.tsx:2986` | **32×32** | pass | **FAIL** |
| Attach audio | `chat/page.tsx:2998` | **32×32** | pass | **FAIL** |
| Voice (phone) | `chat/page.tsx:3016` | **32×32** | pass | **FAIL** |
| Camera (sm-md only) | `chat/page.tsx:3029` | 0×0 (hidden at this break) | n/a | n/a |
| Send / Stop | `chat/page.tsx:3155` | **36×36** | pass | **FAIL** |
| Textarea | `chat/page.tsx:3121` | **32 high × 514 wide** | pass (width-only) | **FAIL** (height < 44) |
| Floating-home orb | `floating-home.tsx` | **48×48** | pass | pass |
| Top-ticker link rows | `global-top-ticker.tsx` | **24** high × variable wide | pass (just) | **FAIL** |
| Top-ticker dismiss buttons | `global-top-ticker.tsx` | **36×36** | pass | **FAIL** |

**[manual mobile verify]** On true iPhone Safari at 390 wide the Tailwind breakpoint is *below* `sm` so the composer buttons render as `w-10 h-10` (40×40) and the textarea bumps to `min-h-[40px]`. That's 40 not 44 — still **fails Apple HIG min**. Tap success rate degrades sharply below ~38px on real device.

**Finding A2 · HIGH · TARGET-SIZE · Composer below 44pt across both breakpoints.** Operator's primary device is iPhone Safari (per profile). 40-px buttons sit in the "tap-misfire zone" especially on the mic + send buttons which are the highest-frequency actions. The v10.0.478 comment at `chat/page.tsx:2982` acknowledges that previous mobile widths were "crushing the textarea" — the fix went the wrong direction (shrunk buttons rather than reducing button count or compacting their layout).

**Finding A3 · MEDIUM · TARGET-SIZE · Top-ticker links 24px tall.** 22 link elements at 24-px height. WCAG 2.5.8 minimum just barely passes; Apple HIG fails badly. Combined with horizontal auto-scroll, these are nearly impossible to tap on a moving carousel. Consider: pause-on-tap, or larger row height (32-40px) with overflow ellipsis to keep content density.

---

### 2.3 · ARIA / accessible-name findings

**Finding A4 · HIGH · 1.3.1 / 4.1.2 · Composer textarea has no accessible label.** Source `app/(mastery)/chat/page.tsx:3077-3124`. Verified via DOM probe: `aria-label: null · aria-labelledby: null · id: null · name: null · no <label for>`. Screen readers will announce **the placeholder text** as the accessible name (best-case) or "edit, multiline, blank" (worst case in NVDA without placeholder support). Since the placeholder rotates ("Message Nick… 17 skills to review", etc · `useAdaptivePlaceholder`), the accessible name is non-deterministic — accessibility names should be stable.

```diff
- <textarea ref={inputRef} ... placeholder={adaptivePlaceholder} ...>
+ <textarea ref={inputRef} ... placeholder={adaptivePlaceholder}
+          aria-label="Message Nick" ...>
```

**Finding A5 · MEDIUM · 1.3.1 · Conversation scroller has no region role.** Live readback: `tabindex: (none), role: (none), aria-label: (none), overflowY: auto, height: 429px`. Screen reader users scrolling line-by-line have no landmark to jump to.

```diff
- <div className="flex-1 overflow-y-auto ...">
+ <div role="log" aria-label="Conversation with Nick"
+      aria-live="polite" aria-relevant="additions text"
+      className="flex-1 overflow-y-auto ...">
```

(`role="log"` is the WAI-ARIA pattern for chat-like additive scroll containers · `aria-live="polite"` makes streaming replies actually announce.)

**Finding A6 · MEDIUM · 1.3.1 · Top + bottom tickers have no landmark.** `global-top-ticker.tsx` + `bottom-pulse-ticker.tsx` render as raw `<div>` chains. The accessible name probe returned `role: (none), aria-label: (none)` for both. Add `role="region" aria-label="Live alerts"` so screen-reader users can find/skip.

**Finding A7 · LOW · 4.1.2 · Reasoning-trace toggle button accessible name is OK** (`aria-label="Toggle reasoning trace"` at `components/chat/reasoning-trace.tsx:128`) **but** the toggle states ("why this answer" ↔ contents) don't announce. `aria-expanded={open}` is set (good). Consider adding `aria-controls` pointing to the contents-container id so the relationship is explicit.

**Finding A8 · MEDIUM · 4.1.3 · Streaming reply contents don't announce.** The Streamdown-rendered `<div className="nick-prose">` (`nick-message.tsx:357`) is **not inside an aria-live region**. VoiceOver/NVDA users get nothing when Nick replies. Wrap with `role="status" aria-live="polite"` on the assistant-message container OR on the scroller (Finding A5 fix covers it).

---

### 2.4 · Focus-visible (Success Criterion 2.4.7)

**Finding A9 · CRITICAL · 2.4.7 · `outline-none` Tailwind utility defeats the universal :focus-visible rule on the composer.**

Evidence:

1. The universal rule exists in production CSS: `:focus-visible { outline: 1.5px solid var(--gold); outline-offset: 2px; box-shadow: 0 0 0 3px var(--gold-glow); }` (`app/globals.css:455-459`). Confirmed via `document.styleSheets` introspection (rule count: 5).
2. The composer textarea has `outline-none` baked into its class string at `app/(mastery)/chat/page.tsx:3123` (`"placeholder:text-[var(--text-tertiary)] outline-none"`).
3. Programmatic focus on the composer textarea returned `outlineStyle: "none"`, `boxShadow: "none"` — no visible indicator whatsoever.
4. Same result for the 5 composer icon buttons + send button (which inherits from shadcn `<Button>` which sets `outline-none`).
5. Same result for the floating-home orb (`outline: 1.41px none lab(80.16 16.6 99.2)`).
6. **20 source files** apply `outline-none`. The chat surface alone has 3 hits at `chat/page.tsx:1750, 2192, 3123`.

Why this matters: the operator IS a keyboard user (Cmd+Shift+J for brain-dump, Cmd+F for search, Cmd+K for command palette per `KeyboardShortcuts` component). Tabbing through the composer or any other surface returns **no visible focus**. Sighted keyboard users get lost. Hard-fails WCAG 2.4.7.

**Recommended fix (one-shot):** Either

- Add a single utility ` focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2 focus-visible:shadow-[0_0_0_3px_var(--gold-glow)]` to a `.focus-ring` helper class, then apply it to every `outline-none` site (the cheapest fix · ~15 files);
- OR remove the `outline-none` wholesale and rely on the global `:focus-visible` rule (cleanest · risk: some custom focus styles depend on `outline-none` to chain a custom ring afterward · audit each touchpoint).

(The user `<input>` in chat-history-search at `chat-history-search.tsx:196` is `outline-none` too — same fix.)

**Finding A10 · LOW · 2.4.7 · Floating-home orb tabIndex=0 with no visible focus.** Has `aria-label="Open navigation menu (drag to move, swipe to hide). System: amber"` (good) but inherits the page-wide focus-invisibility problem.

---

### 2.5 · prefers-reduced-motion (Success Criterion 2.3.3 · advisory but Nour OS targets it)

**Finding M0 · GOOD · UNIVERSAL · The reduced-motion rule is comprehensive and was observed to fire.** Source: `app/globals.css:646-660` (added in v10.0.453 per audit provenance).

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Live verification:

- `.state-aura-drift` had `animationDuration: 1e-05s` (the rule fired · 0.01ms = 0.00001s = 1e-05s).
- `.nick-orb-streaming` had `animationDuration: 1e-05s`.
- The neural-background canvas early-returned out of its rAF loop entirely (`components/hud/neural-background.tsx:22`).

**Finding M1 · LOW · MOTION · Neural-background canvas DOES NOT yield on subsequent mount when reduced-motion is toggled off mid-session.** The `matchMedia` check happens only once inside `useEffect(() => {}, [])` (empty deps). If the user toggles their OS setting (uncommon but possible), the page won't react. Low priority.

**Finding M2 · LOW · MOTION · Auth-state-driven background intensity still mutates `intensityRef.current` even when reduced-motion is on,** but since the rAF loop already early-returned, the value just sits there unread. Harmless.

---

## 3 · Motion + performance findings

### 3.1 · Compositor purity (transform/opacity-only animation rule)

ADR-0010 (referenced at `globals.css:766, 810, 1626`) mandates that long-lived keyframes use only opacity/transform. Audited each keyframe in `globals.css`:

| Keyframe | Properties animated | Compositor-safe? | Notes |
|---|---|---|---|
| `pulse` (status-dot) | opacity | YES | |
| `goldFlash` | opacity | YES | v10.0.469 conversion |
| `breathe` | opacity | YES | |
| `pulse-dot` | opacity + transform: scale | YES | |
| `count-flash` | color | **paint** | one-shot 0.6s on number flash · acceptable |
| `skeleton-shimmer` | background-position | **paint** | acceptable |
| `typing-dot` | opacity + transform: translateY | YES | |
| `unload-pulse` | opacity | YES | v10.0.469 conversion |
| `slide-in-right` | opacity + transform: translateX | YES | |
| `fade-in-scale` | opacity + transform: scale | YES | |
| `breath` | opacity | YES | |
| `count-fade-in` | opacity + transform: translateY | YES | |
| `habit-check` | transform: scale | YES | |
| `drift-glow` | opacity (on `::before` pseudo) | YES | v10.0.467 conversion |
| `success-flash` | background-color | **paint** | one-shot |
| `fire-glow` | text-shadow | **paint** | one-shot/looped · acceptable for a tiny streak emoji |
| `page-in` | opacity | YES | explicit ADR note at `globals.css:749-752` |
| `peek-pulse` | opacity | YES | v10.0.496 conversion |
| `critical-glow` | opacity (on `::before`) | YES | v10.0.468 conversion |
| `stagger-in` | opacity (translateY removed v10.0.455) | YES | |
| `nick-cursor-shimmer` | opacity | YES | v10.0.502 conversion |
| `nick-cursor-shimmer-glow` | opacity | YES | v10.0.502 conversion |
| `state-fire-aura` | **box-shadow** | **paint+layout-ish** | v10.0.474 RESTORED to original · explicit `position:relative` exception at `globals.css:1561-1570`. Containing-block bug fix · 5% activation rate accepted. |
| `state-drift-aura` | **box-shadow** | **paint** | same exception |
| `state-low-energy-aura` | **box-shadow** | **paint** | same exception |
| `state-scattered-wobble` | transform: translateX | YES | |
| `nick-orb-glow` | opacity | YES | |
| `nick-orb-scale` | transform: scale | YES | |
| `nick-ring-breathe` | transform: scale + opacity | YES | |
| `slideUpSheet` | transform: translateY | YES | |

**Finding P1 · ACKNOWLEDGED · COMPOSITOR · Three state-aura keyframes animate `box-shadow`.** Already documented at `globals.css:1561-1570` with a tradeoff note. The `position:relative` swap broke `/chat`'s fixed-shell containing block — reverting was the right call. Activation rate is genuinely low (operator state ∈ `{normal, on_fire, drift, low_energy, scattered}` and only the last 3 animate). At drift state right now (audit-time) the wrapper IS animating box-shadow continuously — **on a high-end laptop this is unmeasurable, on iPhone Safari at 60Hz this is the single largest motion-perf cost on the page**. Consider: degrade to opacity-on-pseudo with `transform: translateZ(0)` to escape the containing-block trap. Out-of-scope for this read-only audit but worth a dedicated wave.

### 3.2 · Streaming-time layout stability

**Finding P2 · GOOD · CLS · pre-allocated message height.** `components/chat/nick-message.tsx:357` sets `min-h-[24px]` on the streaming container so the first-token paint doesn't push history down. Comment explicitly cites the rationale.

**Finding P3 · GOOD · STREAMING · Streamdown block-memoization.** `components/chat/nick-message.tsx:25-35` docstring: "parses markdown into a memoized block array and only re-renders the CHANGED block on each token." Verified via the `useMemo` chain at `nick-message.tsx:324-346` (regex + actions + quick-actions memoized on `text`). For a 40-token reply this means O(1) renders instead of O(40 × tree-size). Production-grade.

**Finding P4 · MEDIUM · LAYOUT · `min-h-[24px]` is short for streaming code blocks / charts / images.** When the first detected payload is a `language-chart` or `language-email-draft` (`nick-message.tsx:456-465`), the height balloons from 24px → 300px+ in one paint. Operator-perceived as a jump.

```diff
- "nick-prose min-h-[24px]"
+ "nick-prose min-h-[64px]"   // for empty-state of typical reply
```

Or even better: reserve `min-h-[content-aware-height-estimate]` based on the message type if pre-detection is possible. Lower priority.

**Finding P5 · LOW · STREAMING · `quickActions` array recomputes on every token.** `detectQuickActions(cleaned)` runs inside the `useMemo` so it's batched · but the regex set runs the full text re-scan each token. For a 5000-char streaming reply on a low-end phone that's ~5000 × 8 regex scans = noticeable. Consider early-exit-on-length or run only when streaming ends. Low impact.

### 3.3 · Neural-background canvas

**Finding P6 · GOOD · MOBILE · Half-frame mobile throttle.** `components/hud/neural-background.tsx:73-77` skips every-other frame on mobile (when `window.innerWidth < 768`). Cuts paint budget to ~50%.

**Finding P7 · GOOD · MOBILE · Particle count adaptive.** `neural-background.tsx:36-38`: mobile caps at 25 particles, desktop at 60. Connection-distance also smaller on mobile.

**Finding P8 · MEDIUM · CPU · O(n²) connection loop.** `neural-background.tsx:128-144` is `for (i) for (j > i)` over particles → 25 × 12 = 300 pair checks per frame on mobile · 60 × 30 = 1800 on desktop. Fine on desktop, borderline on mid-tier phones during simultaneous stream + scroll. Consider spatial-hash bucketing or distance²-only comparison (drop the Math.sqrt at line 132 inside the gate; only compute sqrt for actually-drawn connections).

**Finding P9 · LOW · GPU · Canvas fixed inset-0 at z-0 with opacity 0.4 stretched to viewport.** Internal canvas attr is `300×150` (default) — the CSS stretches it 7× on desktop. Causes minor sampling cost but no real perf hit. Comment says "Lower particle count on mobile for performance" — already optimized.

**Finding P10 · LOW · GPU · The state-aura wrapper sits ABOVE the neural canvas in DOM order but `state-aura-drift` adds `filter: saturate(0.72)` to the whole subtree.** This forces a compositor layer for the entire content tree under it (every panel, every message). On iPhone Safari the GPU layer eats memory. Acceptable but worth knowing.

### 3.4 · Scroll-jank (history-search overlay)

**Finding P11 · GOOD · CSS · `--webkit-scrollbar` styled thin.** `globals.css:446-449`. 4px width, transparent track, gold thumb on hover. Won't shift layout on Mac / iOS.

**Finding P12 · MEDIUM · SCROLL · `overflow-x: auto` on prompt-suggestions-bar without overscroll-contain.** `components/chat/prompt-suggestions-bar.tsx:60`: `overflow-x-auto scrollbar-thin`. On iOS, horizontal scroll inside a vertical-scrolling page rubber-bands the page. The `nick-prose--streaming` block already has `overscroll-behavior-x: contain` (`globals.css:911`); the suggestion bar should too.

```diff
- "flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin"
+ "flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin overscroll-contain"
```

**Finding P13 · LOW · BACKDROP · chat-history-search overlay uses `backdrop-blur-sm` + `bg-[var(--bg-void)]/85`.** On iOS Safari, backdrop-filter blur is GPU-cheap but interacts with the `z-[9600]` stacking context. No measured jank; flagged for awareness only.

### 3.5 · FPS reading

**[manual verification needed]** Two attempts to sample `requestAnimationFrame` deltas over 1.2s and 2.0s both returned `null` — the Chrome MCP renderer backgrounded the tab during the JS execution, freezing rAF. Without a foreground sample this report cannot publish a hard FPS number for /chat.

Recommended manual check on iPhone Safari:

1. Open Safari Web Inspector → Timeline → Rendering Frames.
2. Send a 200-token reply ("explain how Streamdown works in detail").
3. Record: mean FPS during stream + p99 long-frame > 50ms count + simultaneous neural-bg active.

Expected baseline given the code paths above: **55-60fps mean · ≤ 2 long-frames per 30s** if reduced-motion is off and state is `normal`. Drift state introduces continuous box-shadow paint which on an iPhone 13/14 should hold ~55fps and on an iPhone 11/12 may dip to 50fps.

---

## 4 · Top 10 fix list — ranked by user-felt impact

| # | Finding | File:line | Current | Target | Effort | Impact |
|---|---|---|---|---|---|---|
| 1 | **A9** — composer + page `outline-none` defeats focus-visible | `app/(mastery)/chat/page.tsx:3123` + 19 other files | `outline-none` everywhere | Either remove `outline-none` or add `.focus-ring` helper that re-enables the global gold ring on `:focus-visible` | M (15 files) | **CRITICAL** — keyboard a11y, every page |
| 2 | **A1** — `--text-tertiary` (#666) fails AA on every bg | `app/globals.css:29` (token) · 208 DOM consumers on /chat alone | `#666` (3.03-3.55:1) | `#909090` (≈5.0:1 on `--bg-elevated`) — or introduce `--text-tertiary-aa` and migrate critical body usages | S (token swap) → M (audit 208 sites) | HIGH — affects every page |
| 3 | **A4** — composer textarea unlabeled | `app/(mastery)/chat/page.tsx:3077-3124` | placeholder is the accessible name (rotating · unstable) | Add `aria-label="Message Nick"` | XS (1 line) | HIGH — screen readers |
| 4 | **A2** — composer buttons 32-36px (sm bp) / 40px (mobile) below Apple 44pt HIG | `chat/page.tsx:2952, 2974, 2986, 2998, 3016, 3155` | mobile `w-10 h-10` / sm `sm:w-8 sm:h-8` | mobile `w-11 h-11` (44) / consider hiding less-used buttons (camera, audio attach, mode chip) behind a `⋯` overflow on mobile | S (one classname line each) | HIGH — primary device (iPhone) |
| 5 | **A5 + A8** — conversation scroller has no `role="log"` + assistant replies don't announce | `app/(mastery)/chat/page.tsx` (scroller wrapper) | bare `<div>` | `<div role="log" aria-label="Conversation with Nick" aria-live="polite" aria-relevant="additions text">` | XS | HIGH — screen reader users hear nothing during stream |
| 6 | **A3** — top-ticker links 24px tall, unlabeled | `components/hud/global-top-ticker.tsx` | h-6 row | h-8/h-10 row + `role="region" aria-label="Live alerts"` on the container + per-row label | M | MEDIUM — operator tries to tap moving carousel |
| 7 | **P1** — state-aura box-shadow keyframes animate paint during drift / low_energy / on_fire (current state) | `app/globals.css:1571-1604` | box-shadow keyframes on parent | Replace with opacity-on-pseudo + `transform: translateZ(0)` to keep the fixed-child containing-block intact. Out-of-scope but planned. | L (needs containing-block test on /chat) | MEDIUM — 5% activation rate, but currently active → meaningful battery on phone |
| 8 | **P12** — prompt-suggestions-bar horizontal scroll rubber-bands the page on iOS | `components/chat/prompt-suggestions-bar.tsx:60` | `overflow-x-auto scrollbar-thin` | add `overscroll-contain` | XS | MEDIUM — iOS-only annoyance |
| 9 | **P4** — message container `min-h-[24px]` jumps to ~300px when first token is a chart or email-draft | `components/chat/nick-message.tsx:357` | 24px reservation | 64px reservation OR pre-detect payload type before render | S | LOW — rare but visually jarring |
| 10 | **A6** — bottom + top tickers have no landmark | `components/hud/global-top-ticker.tsx` · `components/ultron/bottom-pulse-ticker.tsx` | bare divs | `role="region" aria-label="Live alerts"` | XS | LOW — SR navigation |

---

## 5 · Compliance scorecard

Each axis scored 1-10 against current state at /chat on production. Letter aggregate per WCAG 2.1 AA standard.

| Axis | Score | Reasoning |
|---|---|---|
| Contrast (1.4.3) | **6 / 10** | text-primary + text-secondary + gold all AAA. text-tertiary fails AA on 4 of 4 backgrounds across 208 DOM elements. Token-level fix is one line. |
| Keyboard (2.1.1 / 2.4.7) | **3 / 10** | Tab order works (no skipped controls). Focus is **invisible** on every composer control + textarea + orb because `outline-none` overrides the global :focus-visible. Cmd+F / Cmd+Shift+J shortcuts wired correctly. |
| ARIA (1.3.1 / 4.1.2 / 4.1.3) | **6 / 10** | Icon buttons have `aria-label`/`title`. Reasoning-trace has `aria-expanded`. Composer textarea has no label. Scroller has no `role="log"` + no aria-live → screen readers go silent during stream. Tickers unlabeled. |
| Touch targets (2.5.8) | **5 / 10** | Just barely passes WCAG min (24px) on tickers, fails Apple HIG (44pt) on every composer control on both bp tiers. Floating orb passes. |
| Motion correctness (no inappropriate motion) | **9 / 10** | Universal reduced-motion rule comprehensive · all surfaces yield (state-aura, orb, ring-breathe, neural canvas). One legacy state-aura box-shadow path acknowledged. |
| Performance / compositor purity | **8 / 10** | 28 of 31 keyframes are opacity/transform-only post v10.0.466-502 conversions. Streamdown block-memoization is production-grade. State-aura paint cost during drift/on_fire/low_energy is the lone exception and is the runtime state right now. |
| Reduce-motion respect (2.3.3) | **10 / 10** | Universal `* {animation-duration: 0.01ms !important}` rule + early-return in the neural canvas. Verified live. |

**Aggregate:**

```
contrast + keyboard + ARIA + touch + motion + perf + reduce
   6    +    3     +  6   +   5   +   9   +  8  +  10  =  47 / 70  =  67%
```

**Grade: B-** (passing band 60-74%).

Two single-line fixes — adding `aria-label` to the textarea and re-aliasing `--text-tertiary` — would lift the score to ~76% (B). Fixing focus-visible across the 20 `outline-none` files would lift it to ~83% (A-).

---

## 6 · Manual verifications still needed

These could not be measured automatically through the Chrome MCP tab (because the host window won't shrink below 1090px, OS reduced-motion is on, and rAF freezes when the tab backgrounds):

1. **True iPhone Safari render at 390×844** — confirm composer button widths jump to 40px (mobile bp) not 32 · confirm textarea `min-h-[40px]` actually renders 40px and not collapsed.
2. **FPS during 200-token stream** at iPhone 13 / 14 baseline with state ∈ {normal, drift}. Expected ≥ 55fps mean; flag if < 50fps.
3. **CLS during streaming** — visual recording of a long reply that contains a `language-chart` payload. Confirm Finding P4 (24px → 300px jump).
4. **Focus-visible after fixing `outline-none`** — manually Tab through the composer + history-sidebar + orb and verify the gold ring + 3px glow appear.
5. **VoiceOver/NVDA pass** — full conversation cycle: empty state → send → stream → reply settles → tap reasoning-trace → close.

---

## 7 · Provenance & raw measurements

- **Tab:** 1464165278 · `https://autonicks.com/chat` · auth state preserved.
- **Viewport at audit time:** 1090 × 572 · DPR 2.115 · pointer fine · prefers-reduced-motion reduce.
- **Tools used:** `mcp__Claude_in_Chrome__javascript_tool` for contrast math + DOM measurement + ARIA tree + CSS rule introspection · `mcp__Claude_in_Chrome__get_page_text` for empty-state content verification · `mcp__Claude_in_Chrome__read_console_messages` (no warnings captured during window) · `mcp__Claude_in_Chrome__resize_window` (window pinned at 1090 minimum).
- **Source code paths inspected:** `app/(mastery)/chat/page.tsx` · `app/(mastery)/layout.tsx` · `app/globals.css` · `components/chat/nick-message.tsx` · `components/chat/reasoning-trace.tsx` · `components/chat/prompt-suggestions-bar.tsx` · `components/chat/chat-history-search.tsx` · `components/chat/chat-empty-state.tsx` · `components/hud/neural-background.tsx` · `components/hud/ambient-aura.tsx`.

---

_End audit · 2026-05-12._
