# Spline Scene Briefs · NOUR OS 3D Layer

**v10.0.290 · 2026-05-20 · Phase 1 deliverable**

This document is the build spec for the 4 Spline scenes that make up
the interactive 3D layer. The integration scaffold (`components/3d/`)
is already in place and ships graceful no-ops while the scenes are
unbuilt — see *Status* below.

**Audience:** the operator, building scenes in the Spline editor at
[app.spline.design](https://app.spline.design). Build each scene to
its brief, export it, and paste the resulting
`prod.spline.design/<id>/scene.splinecode` URL into the matching slot
in `components/3d/scene-registry.ts`.

---

## Status

| Phase | State |
|---|---|
| 1 · Integration scaffold | **Done** — `components/3d/` (8 files) + this doc |
| 2 · Build scenes in Spline | **You are here** — build per the briefs below |
| 3 · Wire each surface | Pending — one PR per surface, after URLs land |
| 4 · Mobile Lighthouse + tune | Pending |

With TBD placeholder URLs in `scene-registry.ts`, `<SplineScene>`
renders `<SceneSkeleton>` (a gold-on-dark shimmer) plus a tiny
dev-only "scene pending" badge. Nothing crashes; the Spline runtime
chunk is never even fetched. The moment a real URL replaces a `TBD:`
sentinel, that scene goes live wherever its wrapper is mounted.

---

## Shared design contract — applies to ALL 4 scenes

The 3D layer must read as part of NOUR OS, not a generic Spline demo.

### Color — gold-on-dark, no exceptions

The app's real tokens (from `app/globals.css`). Match these hex
values in the Spline editor's color pickers:

| Token | Hex | Use |
|---|---|---|
| `--gold` | `#FDB913` | primary accent — edges, active nodes, emphasis |
| `--gold-dim` | `#D49A0E` | secondary / low-energy gold |
| `--bg-void` | `#050505` | scene background (or transparent) |
| `--bg-base` | `#0A0A0A` | near-black depth |
| `--bg-elevated` | `#1A1A1A` | mid-tone surfaces / inactive geometry |
| `--text-tertiary` | `#909090` | quiet / inactive elements |
| `--status-green` | `#22C55E` | health / win state (use sparingly) |
| `--status-red` | `#EF4444` | **only** for critical alert states |

**Hard bans** (per the operator's anti-AI-slop UI gate):
- **No purple / violet.** No purple gradients, no violet "spark"
  accent. `app/globals.css` deliberately renamed `--status-purple`
  to `--status-ai` "to remove the standing invitation to add purple
  gradients" — the 3D layer holds that line. The accent vocabulary is
  gold; status states are green/red.
- No pure black `#000000` — the void is `#050505`.
- No Inter font. If a scene has text, use a condensed grotesk or none.
- No symmetric, perfectly-centered "hero logo" compositions — the
  geometry should carry information, not decoration.

### Motion — ambient, never attention-stealing

Harmonize with the app's existing motion vocabulary (`pulse-live`
2s ease-in-out, `shimmer` 2.4s sweeps, the 45s rotation of
`components/goals/mastery-polyhedron.tsx`):

- Idle rotation: one revolution per **40–60 seconds**. Slow enough to
  be ambient.
- Idle pulse: a gentle sine on emissive intensity or scale,
  **3–5 second** period (≈ 0.2–0.3 Hz).
- No fast spins, no bouncing, no looping camera fly-throughs.
- Honor reduced motion: keep idle motion subtle enough that it does
  not need a hard stop, and design each scene so it still reads when
  near-static. (The scaffold passes no reduced-motion flag in
  Phase 1; Phase 4 may add one.)

### Performance — the operator is mobile-heavy

Set these in the Spline editor **before** exporting:

- **Play Settings → Geometry Quality = Performance.** This is the
  mobile geometry tier the plan calls for.
- **Limit FPS = 30** for the ambient scenes (Command Core, AI Pulse);
  60 is acceptable for Knowledge Galaxy and Framework Orbit.
- Keep polycount low — favor instanced/duplicated low-poly primitives
  over high-subdivision meshes.
- Minimize distinct materials; reuse one or two PBR materials.
- No expensive shaders — no raymarching, SSR, refraction — and no
  post-processing stacks (bloom, DOF, SSAO) unless a brief explicitly
  calls for it. They are costly on mobile GPUs.
- Lighting: at most one key light + one fill. No area lights, no IBL
  probes.
- **Hide Spline Logo = ON** (requires a paid Spline plan).
- **Target file size: ≤ 2 MB per scene** (`.splinecode`). Treat it as
  a ceiling, not a goal — smaller is better. If a scene won't fit,
  cut geometry detail before anything else. Per-scene targets below
  are tighter than 2 MB.

After any Play Settings change, click **Generate Draft** or
**Promote to Production** before copying the URL — the URL does
**not** auto-update.

### Variables — the data-binding contract

Each scene below lists the runtime **Variables** it must expose
(Spline editor → Variables panel). The scaffold's `useSceneBinding`
hook calls `app.setVariable(name, value)` with exactly these names,
throttled to 5s. Names are case-sensitive and must match exactly.
Variable types are `number`, `boolean`, or `string` only.

If a scene does not declare a variable the scaffold tries to set, the
runtime silently no-ops it — but the binding then does nothing, so
the names below are a strict contract. (Phase 1 wrappers pass an
empty variable map — they are stubs; Phase 3 wires the real data.)

---

## Scene 1 · Command Core

| | |
|---|---|
| **Surface** | Homepage Ultron — `components/ultron/ultron.tsx` (Phase 3) |
| **Wrapper** | `components/3d/command-core.tsx` |
| **Registry slot** | `SCENE_URLS.commandCore` |
| **Role** | Highest-visibility surface · ambient OS-landing backdrop |
| **Target file size** | **≤ 1.5 MB** — it is a backdrop, keep it lean |

### Geometry

A single rotating geometric **core** — a faceted polyhedron (an
icosahedron, an octahedron, or a low-poly Platonic compound —
designer's call), gold wireframe edges over a dark, semi-transparent
interior. Think "the core of a power source, contained." It sits
*behind* the homepage data overlay (the wrapper mounts as an
absolute, negative-z backdrop), so it must never compete for
attention: dim, deep, and slow.

- One central mesh group, roughly 30% of the viewport's smaller
  dimension. No orbiting satellites, no scene clutter.
- Gold (`#FDB913`) edges; interior faces in `--bg-base` /
  `--bg-elevated`.
- Optional: a faint gold dust field behind the core (≤ 120 instanced
  particles, low opacity) and a faint gold horizon line at the top
  edge. Both subtle. No floor, no shadow plane.

### Idle animation

- Slow Y-axis rotation, ~50s per revolution (~7°/s).
- A gentle ~4s (≈ 0.25 Hz) emissive pulse on the wireframe edges,
  synced in feel to the app's `pulse-live` keyframe.
- If a dust field is used: particles drift slowly outward and fade at
  the edges.

### Data-reactive behavior + Variables

| Variable | Type | Range | Drives |
|---|---|---|---|
| `healthScore` | number | 0–100 | Core integrity — 100 = whole, bright, stable; lower = edges flicker, interior dims (emissive intensity). |
| `alertLevel` | string | `"info"` \| `"warn"` \| `"critical"` | Edge color — `info` = gold, `warn` = amber-shift, `critical` = `--status-red` rim. |
| `situationCount` | number | 0–n | Core scale / dust density — a faint size pulse when active items climb. |

---

## Scene 2 · Knowledge Galaxy

| | |
|---|---|
| **Surface** | `app/(mastery)/brain/galaxy/page.tsx` (Phase 3) |
| **Wrapper** | `components/3d/knowledge-galaxy.tsx` |
| **Registry slot** | `SCENE_URLS.knowledgeGalaxy` |
| **Role** | The flagship scene · replaces the existing SVG galaxy |
| **Target file size** | **≤ 2 MB** — the most generous budget; instancing should keep it well under |

### Geometry

A real 3D **node constellation** — brain-memory records as a cloud of
small glowing spheres distributed in a flattened spiral disc (a
galaxy shape, not a pure sphere cloud), with faint connecting lines
between near neighbors. The existing page is already a "galaxy" SVG,
so a 3D node graph is a thematic upgrade, not decoration.

- 40–80 **instanced** low-poly spheres — use instancing, do not
  hand-place high-poly meshes. (Scale toward the lower end for the
  mobile budget.)
- Sphere brightness/emissive = that node's confidence: bright gold
  (`--gold`) = high confidence, dim gold (`--gold-dim`) = low.
  Sphere size keyed to recency in 2–3 tiers.
- Thin, low-opacity gold lines connect nodes within a proximity
  threshold — suggests semantic neighborhoods. Keep line count modest.
- A faint depth haze / nebula gradient toward the back for parallax
  depth — gold → `--bg-void`. Very subtle. **No violet in the
  nebula.**
- This page has lower traffic, so the perf budget is the most
  permissive of the four — but still respect the ceiling.

### Idle animation

- The whole constellation drifts — a very slow Y rotation (~60s)
  plus a gentle per-node bob so it feels alive, not frozen.
- Subtle twinkle on node emissive (de-synced sine per node).

### Interactive features (optional)

- Enable **Pan** in Play Settings with limits — the operator can drag
  to inspect regions. Enable **Zoom** clamped (min 0.5×, max 2×) so
  the view can't get lost.
- Optional: hover events on spheres can emit a Spline event for a
  future tooltip. Not required for Phase 3.

### Data-reactive behavior + Variables

| Variable | Type | Range | Drives |
|---|---|---|---|
| `memoryCount` | number | 0–n | How many nodes are lit / how dense the visible cloud is. |
| `topConfidence` | number | 0–1 | Brightness ceiling — scales the brightest nodes' emissive. |
| `axisShift` | number | 0–1 | Drift intensity — how much the constellation re-arranges when the 8-axis self-model shifts. |

---

## Scene 3 · Framework Orbit

| | |
|---|---|
| **Surface** | `app/(mastery)/system/lens-stats/page.tsx` (Phase 3) |
| **Wrapper** | `components/3d/framework-orbit.tsx` |
| **Registry slot** | `SCENE_URLS.frameworkOrbit` |
| **Role** | Strategic-AI telemetry anchor, above the top-frameworks table |
| **Target file size** | **≤ 1.5 MB** — 52 *instanced* spheres are cheap; tight on purpose |

### Geometry

**52 small spheres orbiting** a central point — one sphere per
strategic-frameworks lens (Pareto, OKRs, First-Principles, …). It
should read like a particle accelerator seen from the side: a system
in motion. This scene lives *inside a `<GlassCard>`* above the
existing table — it must not eat the page.

- A small, calm central anchor — a dark-gold core sphere representing
  the registry.
- 52 **instanced** low-poly spheres on varied orbital radii and
  inclinations (organic, not concentric rings) — a single material
  with per-instance color and scale.
- Top 3 firers: gold (`--gold`), large (~3× base size).
  Middle tier: `--gold-dim`, medium. Long tail: `--text-tertiary`
  gray, small.
- No background detail — it lives in a card, target ~16:9 at a card
  height of ~280–320px.

### Idle animation

- Each sphere orbits the center on its own period (~8–30s for a full
  revolution); inclinations vary so the cloud has 3D depth.
- A faint ~3s (≈ 0.3 Hz) pulse on the central anchor.

### Data-reactive behavior + Variables

| Variable | Type | Range | Drives |
|---|---|---|---|
| `topFirerSize` | number | 0–1 | Scale of the #1 most-fired lens sphere (linear interp between base and ~3×). |
| `secondFirerSize` | number | 0–1 | Scale of the #2 lens sphere. |
| `thirdFirerSize` | number | 0–1 | Scale of the #3 lens sphere. |
| `fallbackRate` | number | 0–1 | System-wide lens-fallback proportion — when high (> ~0.3) the central anchor pulses `--status-red`: a visual alert that lens routing is degraded. |

---

## Scene 4 · AI Pulse

| | |
|---|---|
| **Surface** | `app/(mastery)/chat/page.tsx` status strip (Phase 3) |
| **Wrapper** | `components/3d/ai-pulse.tsx` |
| **Registry slot** | `SCENE_URLS.aiPulse` |
| **Role** | Smallest scene · most-touched surface · pulses with AI work |
| **Target file size** | **≤ 800 KB** — smallest scene on the most-loaded route |

### Geometry

A tiny living **indicator** — a single small, faceted shape (a
low-poly ico-sphere or a tetrahedron — designer's call) that lives in
the chat status strip / sidebar. Small footprint: this is a status
indicator with depth, not a centerpiece. It gives the operator a
peripheral signal of whether the AI is healthy without parsing logs.

- One mesh, gold, emissive, on a transparent background (the strip's
  own background shows through). Lit from one side.
- Designed to read at a small render size (~32–64px).
- Optional: a faint inner core pulsing slightly out of phase with the
  outer mesh.

### Idle animation

- A slow breathing pulse — scale ~0.95 ↔ 1.05 at ~0.5 Hz — this is
  the "idle / waiting" state.
- A slow Y rotation, ~1 revolution per 8s.

### Data-reactive behavior + Variables

| Variable | Type | Range | Drives |
|---|---|---|---|
| `pulseSpeed` | number | 0–1 | Pulse rate — 0 = slow idle breath (~0.5 Hz), 1 = rapid pulse (~3 Hz) while the AI is actively streaming. |
| `colorIndex` | number | 0 \| 1 \| 2 | Mesh color — `0` = gold (`#FDB913`, normal idle/active), `1` = a brighter gold "AI working" tint, `2` = `--status-red` (error/stalled). All three stay inside the gold-on-dark family except the red error state — **no purple**. |

---

## Scene-readiness checklist — verify before exporting each scene

- [ ] Geometry uses instancing where the brief calls for it (Galaxy, Orbit).
- [ ] Materials are PBR — no raymarching, SSR, or refraction shaders.
- [ ] Lighting: 1 key light + 1 fill at most. No area lights, no IBL.
- [ ] No purple / violet anywhere. Accent is gold; status is green/red.
- [ ] Every **Variable** from the scene's brief is declared in the
      Variables panel, with the exact name and type.
- [ ] Play Settings: Geometry Quality = Performance; FPS limited per
      the per-scene note; Hide Spline Logo ON (paid plan).
- [ ] Tested at 1280×720 in editor preview — no jank, no missing
      materials.
- [ ] File size is within the scene's target ceiling.
- [ ] Exported via Code Export — URL ends in `/scene.splinecode`.

---

## After you build a scene

1. Confirm the readiness checklist above.
2. Export → Code Export → copy the
   `prod.spline.design/<id>/scene.splinecode` URL.
3. Open `components/3d/scene-registry.ts` and replace that scene's
   `TBD:<name>` value with the real URL.
4. Run `pnpm typecheck && pnpm lint` — both must stay green.
5. Phase 3 then mounts the wrapper into its surface (one PR per
   surface, per the plan's build sequence).

The scaffold needs no code changes when a URL lands —
`isSceneReady()` flips the scene on automatically.

## Iteration loop — after scenes are live

The scaffold separates "scene URL" from "scene quality," so iteration
is cheap: open the scene in the Spline editor, adjust, re-promote to
production, and the same URL serves the updated scene — no scaffold
change, no redeploy of `components/3d/`. This is the payoff of the
registry indirection.
