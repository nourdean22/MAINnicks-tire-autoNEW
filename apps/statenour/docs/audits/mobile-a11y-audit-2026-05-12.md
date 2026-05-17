# Mobile + a11y audit · 2026-05-12

**Scope:** spot-audit of two top mastery surfaces (`/system/prompt-parity`,
`/chat`) on 284px-wide mobile viewport via Claude Preview eval. Read-only ·
no code changes in this audit doc · concrete fixes filed below as v10.0.498+
candidates.

**Skill stance:** `fixing-accessibility` + `react-best-practices` +
`frontend-design` (DFII scoring on each fix).

## Findings

### A. Dismiss-button micro-targets (10×13 px) · HIGH severity

Right-rail card dismiss buttons (`×`) on `/chat` render at 10×13px on
mobile viewport. Classes are:

```
opacity-0 group-hover/cell:opacity-60 hover:!opacity-100 ...
```

- Below WCAG 2.5.5 minimum target size (24×24 CSS px is AA, 44×44 is AAA)
- Below iOS HIG (44pt) and Material (48dp) touch-target guidelines
- Hidden-on-hover pattern doesn't translate to touch — the
  `group-hover` only fires after a long-press on iOS, and never on
  Android touch
- Same component instance appears 30+ times per typical right-rail
  state (capture · reflect · nick-noticed · brain memory · mind ·
  life · brain)

**Fix candidates** (one of these, not all):
1. Always-visible at smaller opacity (e.g. 0.35) so touch users can
   target without needing to long-press hover-equivalent.
2. Move dismiss to a swipe gesture on touch · keep `×` for hover/cursor.
3. Enlarge the hit area to 36×36 via padding without growing the
   visual `×` glyph (`padding: 12px; margin: -12px;` pattern).

Recommend **option 3** — preserves the editorial minimalism (small
visual `×`) while making touch viable. Pattern goes into a shared
`<DismissButton>` primitive so the fix lands everywhere at once.

### B. ~~No visible focus state~~ · **FALSE POSITIVE** (audit-method error)

Audit script reported 5/5 sampled buttons missing focus state. On
re-verification: `app/globals.css:455` already defines a global
`:focus-visible` rule (1.5px gold outline + 2px offset + 3px gold
glow shadow). The audit got a false negative because programmatic
`el.focus()` does NOT trigger `:focus-visible` in modern browsers ·
that pseudo-class only matches keyboard-driven focus. The eval ran
mouse-equivalent focus and read styles before `:focus-visible` had
a chance to match.

**Verdict:** No fix needed. Focus styles are wired correctly.

**Audit script correction filed below** · the methodology should
dispatch a synthetic Tab key event or check for the rule's
existence in stylesheets rather than relying on programmatic focus.

### C. Tab target widths flagged but acceptable · LOW severity (false-positive)

The audit script flagged window-selector tabs at 29×44 px (e.g.
"1d", "3d", "7d", "14d"). Width is below the 36 threshold but the
HEIGHT (44px) meets Apple HIG, and the tabs are spaced with adequate
gaps in a horizontal row. No fix needed.

Audit script threshold should be revised to: flag elements where
`width < 36 AND height < 36` (both axes), not `width < 36 OR height
< 36` (either).

## Coverage gaps · not yet audited

- Lighthouse perf (LCP / CLS / FID) — needs real browser, not eval
- Color contrast across the editorial palette beyond body text
- Reduced-motion query coverage (universal rule was added v10.0.453
  · spot-check that all keyframes respect it)
- Screen reader narration on key surfaces

## Filing as v10.0.498+ candidates

| Push candidate | Item | Effort | Risk |
|---|---|---|---|
| ~~v10.0.498~~ | ~~Global `:focus-visible` rule~~ | — | already shipped at `app/globals.css:455` |
| v10.0.498 | `<DismissButton>` primitive with 36×36 hit area | 30 min | Medium · touches multiple right-rail cards |
| (later) | Real Lighthouse pass (mobile preset) | 30 min | Read-only |
| (later) | Audit script refinement · use synthetic Tab key for focus testing · `<both axes>` for tap-target threshold | 15 min | Internal tooling |

## References

- ADR-0010 · Editorial-minimalist aesthetic
- WCAG 2.5.5 Target Size (AA) · 24px minimum, AAA 44px
- iOS HIG · 44pt minimum touch target
- Material Design · 48dp minimum

---

**Audit method:** Claude Preview eval on `/system/prompt-parity` + `/chat`
at viewport 284×607. Sampled 23 buttons + 37 interactive elements per
page. Findings are systemic (same pattern across both pages).
