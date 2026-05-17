# Spline Scene Briefs · v10.0.290

Design briefs for the 4 Spline 3D scenes that anchor the
**interactive command-center UI upgrade**. Builds in Spline editor at
[https://app.spline.design](https://app.spline.design). Each scene
should reflect the gold-on-dark operator-grade brand stance: rich but
never busy, dimensional but never crowding the data overlay.

---

## Brand tokens (apply to every scene)

| Token | Hex | Usage |
|---|---|---|
| `--bg-base` | `#0A0A0A` | Scene background (hide via Play Settings · the page already has this color behind) |
| `--gold` | `#FDB913` | Primary accent · edges, glows, key lights, hot states |
| `--gold-dim` | `#D49A0E` | Secondary accent · receding edges, mid-tone metals |
| `--violet-400` | `#A78BFA` | Identity / cognition tone · used for /brain galaxy + Ollama pulse |
| `--text-primary` | `#F0F0F0` | Stark white-ish · use sparingly for highlights only |
| `--emerald-400` | `#34D399` | Health / win state |
| `--rose-400` | `#FB7185` | Critical / error state |

Brand stance: low saturation overall, gold as the anchor, violet as the
secondary spark. Avoid AI-default purple gradients · the violet here is
discrete, never a fill.

---

## Universal Play Settings (set on EVERY scene before exporting)

In Spline editor: Play (top-right) → Play Settings:

- ✅ **Hide Background ON** · the page already has a dark background; a transparent scene composites cleanly
- ✅ **Hide Spline Logo ON** · requires paid Spline plan (do this if available)
- ✅ **Geometry Quality: Performance** · mobile-first — operator is on phone often
- ✅ **Disable Page Scroll, Zoom, Pan** unless scene specifically needs them (Knowledge Galaxy is the only one that wants pan)
- ✅ **Limit FPS · 30** for ambient scenes (Command Core, AI Pulse) · 60 OK for Knowledge Galaxy + Framework Orbit (they get more visible interaction)

After settings change, click **Generate Draft** or **Promote to Production** before copying the URL — the URL does NOT auto-update.

Then: **Export → Code Export → copy `prod.spline.design/<id>/scene.splinecode`** → paste into the matching slot in `components/3d/scene-registry.ts`.

---

## Scene 1 · Command Core

**Surface:** `app/(mastery)/page.tsx` (homepage Ultron) · ambient backdrop, full viewport, behind data
**Wrapper:** `components/3d/command-core.tsx` · slot `commandCore`
**Target file size:** ≤ 1.5 MB
**Target dimensions:** square / 16:9 friendly · the wrapper stretches to fill

**Aesthetic intent:**
A geometric form that signals "this is your operating system." Not a logo, not a hero · an ambient anchor that exists behind the data so the homepage feels like a command center rather than a list. Subtle rotation, gold-edged crystalline geometry, dark interior. Like looking at the core of a power source.

**Visual recipe:**
- A central form: an octahedron OR an icosahedron OR a low-poly Platonic compound (designer's call). Wireframe + thin gold edges, semi-transparent dark interior. Roughly 30% of the viewport's smaller dimension.
- Behind it: a slow-drifting particle field — gold dust, ~80–120 particles, low opacity, slight depth-of-field.
- Top edge: a faint horizon line, gold gradient → transparent. Anchors the form vertically.
- No floor / no shadow plane. The form exists in dark space.

**Idle motion (when no data variation):**
- Central form rotates on Y axis at ~10° / second
- Particles drift radially outward at ~3 px/sec, fade out at edges
- Faint pulse on the central form's emissive glow at 0.5 Hz

**Data-bound variables (expose in Spline editor):**
- `healthScore` · number 0–100 · drives core form's emissive intensity (100 = bright gold, 0 = dim)
- `alertLevel` · string `"info" | "warn" | "critical"` · drives core form's edge color (info = gold, warn = amber, critical = rose)
- `situationCount` · number · drives particle density (more particles when more active items)

**Performance notes:**
- This scene mounts on the homepage · it MUST be fast. Aim ≤ 1.5 MB.
- Particles: keep below 150 instances. Use Spline's instance feature, not individual objects.
- Materials: PBR, low metalness, low roughness on gold edges. Avoid raymarching, avoid SSR.

---

## Scene 2 · Knowledge Galaxy

**Surface:** `app/(mastery)/brain/galaxy/page.tsx` · replaces existing SVG visualization
**Wrapper:** `components/3d/knowledge-galaxy.tsx` · slot `knowledgeGalaxy`
**Target file size:** ≤ 2.5 MB (this is the flagship · highest budget)
**Target dimensions:** full viewport · the SVG it replaces is roughly 70vh × 100vw

**Aesthetic intent:**
A real 3D galaxy of memory items. Replaces the existing SVG nodes/edges with actual orbiting bodies. Camera slowly arcs around the galaxy core; the operator can pan to inspect. High-confidence memories glow gold; emerging / low-confidence ones glow violet. Larger and closer = more recent.

**Visual recipe:**
- ~150–250 small spheres distributed in a flattened spiral disc (galaxy shape · not a pure sphere cloud).
- Sphere sizes: 3 tiers (small / medium / large) keyed to recency.
- Sphere colors: gold (`--gold`) for high-confidence, violet (`--violet-400`) for emerging / low-confidence. Smooth interpolation between.
- Dust + thin connecting lines between near-by spheres (low opacity). Suggests semantic neighborhoods.
- Background: faint nebula gradient · gold → black → violet. Very subtle.

**Idle motion:**
- Camera orbits the galaxy center on a slow arc · 30 second loop
- Galaxy itself rotates on its own axis at ~2° / second
- Subtle parallax shimmer on the dust layer

**Data-bound variables:**
- `memoryCount` · number · drives sphere-cloud density (more memories = more visible bodies)
- `topConfidence` · number 0–1 · drives the brightest gold sphere's emissive intensity
- `axisShift` · number `-1 | 0 | 1` · subtle camera nudge or color tint (rising / stable / falling)

**Interactive features (Spline editor):**
- Enable **Pan** in Play Settings · the operator can drag to inspect different regions
- Enable **Zoom** with limits (min 0.5×, max 2×) · prevents getting lost
- Optional: hover events on spheres → emit `node-hover` event with sphere name. Wrapper can map to a tooltip in v2.

**Performance notes:**
- This is the flagship scene · 2.5 MB ceiling but try to land at ~2 MB.
- Use instancing for spheres (Spline supports it) · DON'T create 250 individual objects.
- Consider LOD: hide the smallest spheres at low zoom levels.

---

## Scene 3 · Framework Orbit

**Surface:** `app/(mastery)/system/lens-stats/page.tsx` · embedded above the existing top-frameworks table inside a `<GlassCard>` host
**Wrapper:** `components/3d/framework-orbit.tsx` · slot `frameworkOrbit`
**Target file size:** ≤ 1.5 MB
**Target dimensions:** roughly 16:9, fits within a card height of ~280–320 px

**Aesthetic intent:**
52 framework lenses orbit a central point. Each is a small sphere; top-fired ones are larger and gold; less-used ones are smaller and gray. Visual signal: which lenses are pulling weight today. Like looking at a particle accelerator from the side.

**Visual recipe:**
- A central anchor: a small dark gold sphere (the "core" representing the registry).
- 52 spheres orbiting at varied distances + speeds (the orbits should look organic, not concentric rings — slight inclinations, varied radii).
- Top 3 firers: gold (`--gold`), large (~3× base size).
- Middle tier: gold-dim (`--gold-dim`), medium.
- Long tail (most): gray, small.
- Subtle motion blur on faster orbits.
- No background detail · this is meant to live inside a card, not eat the page.

**Idle motion:**
- Each sphere orbits on its own period (8–30 seconds for a full revolution)
- Inclinations vary so the cloud has 3D depth
- Faint pulse on the central anchor at 0.3 Hz

**Data-bound variables:**
- `topFirerSize` · number 0–1 · scales the largest sphere (linear interp between base and 3×)
- `secondFirerSize` · number 0–1 · scales the second-largest
- `thirdFirerSize` · number 0–1 · scales the third-largest
- `fallbackRate` · number 0–1 · when high (> 0.3), the central anchor pulses red — visual alert that lens routing is degraded

**Performance notes:**
- 52 spheres · use instancing. Single material with per-instance color/scale.
- Card-embedded · low priority. Aim for ≤ 1.5 MB.
- This scene doesn't need to be visible-quality at full screen · 16:9 small canvas is the target.

---

## Scene 4 · AI Pulse

**Surface:** `app/(mastery)/chat/page.tsx` · added to the existing status strip (sidebar / top bar · small footprint)
**Wrapper:** `components/3d/ai-pulse.tsx` · slot `aiPulse`
**Target file size:** ≤ 800 KB (smallest · this is decorative, not central)
**Target dimensions:** small · 32 × 32 px to ~64 × 64 px

**Aesthetic intent:**
A tiny living indicator that pulses with AI provider activity. Color shifts gold (Venice/active), violet (Ollama), red (error/stalled). Pulse speed reflects streaming latency. The operator gets a peripheral signal of whether the AI is healthy without parsing logs.

**Visual recipe:**
- A single small mesh: a low-poly ico-sphere OR a tetrahedron · designer's call. Lit from one side.
- Material: emissive, color-driven by `colorIndex` variable.
- Optional: a faint inner core that pulses out of phase with the outer mesh.

**Idle motion:**
- Soft idle pulse: scale 0.95 ↔ 1.05 at 0.5 Hz
- Rotation: 1 full rotation per 8 seconds on Y axis

**Data-bound variables:**
- `pulseSpeed` · number 0–1 · scales the pulse frequency (0 = idle 0.5 Hz, 1 = active 3 Hz)
- `colorIndex` · number 0|1|2 · 0 = gold (Venice/active default), 1 = violet (Ollama), 2 = red (error)

**Performance notes:**
- Tiny scene · should land at < 800 KB easily.
- Single mesh, single material · don't add particles, don't add lighting beyond one directional light.
- This sits in the highest-traffic page (/chat) · keep it cheap.

---

## Scene-readiness checklist (for the operator building in Spline)

For each scene, verify before exporting:

- [ ] Geometry uses instancing where possible (Galaxy, Orbit)
- [ ] Materials are PBR · no expensive shaders (raymarching, SSR, refraction)
- [ ] Lighting: 1 key light + 1 fill at most. No area lights, no IBL probes.
- [ ] Variables declared in Spline editor's Variables panel · names match exactly the strings in this brief
- [ ] Play Settings: Hide Background ON, Geometry Quality = Performance
- [ ] (Paid plan only) Hide Spline Logo ON
- [ ] Tested at 1280×720 in editor preview · no jank, no missing materials
- [ ] Exported via Code Export · URL ends in `/scene.splinecode`
- [ ] URL pasted into `components/3d/scene-registry.ts` matching slot

Once a URL lands in the registry, the wrapper component will start mounting the live scene automatically · no other code change needed.

---

## After scenes are live · iteration loop

The scaffold separates "scene URL" from "scene quality." This means iteration is cheap:

1. Notice the scene needs adjustment (lighting too bright, motion too fast, etc.)
2. Open the scene in Spline editor, adjust
3. Re-promote to production
4. Copy the (same) URL or paste a new one
5. Re-deploy · no scaffold change

This is the killer pattern for Spline: the scaffold stays static once shipped.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
