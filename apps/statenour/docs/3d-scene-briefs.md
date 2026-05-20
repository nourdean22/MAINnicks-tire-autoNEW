# 3D Scene Briefs · NOUR OS 3D Layer

**v10.0.290 · 2026-05-20 · Wave 53 · React Three Fiber**

This document is the design spec for the 4 scenes that make up the
interactive 3D layer. **The layer is built with React Three Fiber
(R3F)** — `three` + `@react-three/fiber` + `@react-three/drei`.

> **Wave 53 pivot — Spline → R3F.** An earlier step scaffolded this
> layer against Spline (scenes authored in the Spline visual editor,
> exported as `.splinecode`, loaded by URL). That approach was
> dropped: Spline needs a human in its editor, whereas R3F is *code* —
> the right medium for a data-reactive React app and for an agent to
> build and iterate. The per-scene **design** below is medium-agnostic
> and survived the pivot unchanged; only the build mechanics changed.

**Audience:** any engineer (or agent) extending the 3D layer. Each
scene is a plain React component under `components/3d/scenes/` — edit
the component, run `pnpm typecheck && pnpm lint`, done. There is no
external asset, no editor, no export step.

---

## Architecture — how the 3D layer is wired

```
components/3d/
  scene-skeleton.tsx        gold-on-dark loading shimmer (the lazy fallback)
  scene-canvas.tsx          generic R3F host — "use client"
  canvas-inner.tsx          the ONLY module importing the R3F <Canvas>
  scenes/
    command-core-scene.tsx      ┐
    knowledge-galaxy-scene.tsx  │ the 4 R3F scene components
    framework-orbit-scene.tsx   │ (meshes / lights / useFrame motion)
    ai-pulse-scene.tsx          ┘
  command-core.tsx          ┐
  knowledge-galaxy.tsx      │ the 4 per-surface wrappers — mount
  framework-orbit.tsx       │ <SceneCanvas> with the matching scene
  ai-pulse.tsx              ┘ + pass typed data props
```

- **`SceneCanvas`** is the generic host. It lazy-loads the R3F
  `<Canvas>` via `next/dynamic({ ssr: false })` (three touches
  `window`/WebGL — it must stay client-only and code-split), shows
  `<SceneSkeleton>` while the chunk resolves, and owns the
  performance lifecycle:
  - **IntersectionObserver pause** — off-screen, the canvas
    `frameloop` flips to `"never"` (render loop stopped, WebGL context
    kept warm); on-screen, `"always"`. `rootMargin` ~150px.
  - **`prefers-reduced-motion`** — when set, `frameloop` is `"demand"`:
    one static frame, no animation loop. Each scene is designed to
    still read when static.
  - **`dpr={[1, 1.5]}`** — caps the device-pixel-ratio so high-DPI
    mobile screens don't render at 3× cost.
- **`canvas-inner`** is the single module that imports `<Canvas>`,
  kept behind the `ssr:false` dynamic boundary.
- **Scene components** take typed props = the live data they react
  to, and animate idle motion via `useFrame`.
- **Per-surface wrappers** mount `<SceneCanvas>` with their scene and
  (for now) pass placeholder default props. Real-data wiring + page
  mounting is a later phase.

To change a scene, edit its component. The same-URL "re-promote in the
editor" iteration loop Spline required is gone — it's just code.

---

## Status

| Phase | State |
|---|---|
| 1 · Integration scaffold | **Done** — `components/3d/` host + skeleton |
| 2 · Build the 4 R3F scenes | **Done** — Wave 53 · scenes + wrappers with placeholder props |
| 3 · Wire real data + mount into pages | Pending — derive each scene's props from its live data source, mount each wrapper into its surface |
| 4 · Mobile Lighthouse + tune | Pending |

The wrappers currently pass sensible **placeholder** prop values
(e.g. a healthy `healthScore`, a moderately dense galaxy) so each
scene renders and visibly animates. Phase 3 replaces the placeholders
with real data and mounts the wrappers into their pages.

> Note: `FrameworkOrbit` is already mounted in
> `app/(mastery)/system/lens-stats/page.tsx` (a pre-existing mount
> from the Spline scaffold). It renders with placeholder props until
> Phase 3 wires `/api/system/lens-stats`.

---

## Shared design contract — applies to ALL 4 scenes

The 3D layer must read as part of NOUR OS, not a generic 3D demo.

### Color — gold-on-dark, no exceptions

The app's real tokens (from `app/globals.css`). Set these hex values
as R3F material / light colors:

| Token | Hex | Use |
|---|---|---|
| `--gold` | `#FDB913` | primary accent — edges, active nodes, emphasis |
| `--gold-dim` | `#D49A0E` | secondary / low-energy gold |
| `--bg-void` | `#050505` | scene background (the `<Canvas>` runs with `alpha: true` — the surface's own dark background shows through) |
| `--bg-base` | `#0A0A0A` | near-black depth / interior faces |
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
`components/goals/mastery-polyhedron.tsx`) — drive it all from
`useFrame` reading `state.clock.elapsedTime`:

- Idle rotation: one revolution per **40–60 seconds**. Slow enough to
  be ambient.
- Idle pulse: a gentle sine on emissive intensity or scale,
  **3–5 second** period (≈ 0.2–0.3 Hz).
- No fast spins, no bouncing, no looping camera fly-throughs.
- Honor reduced motion: `SceneCanvas` flips `frameloop` to `"demand"`
  when `prefers-reduced-motion: reduce` is set — the scene renders one
  static frame. Design each scene so it still reads when static.

### Performance — the operator is mobile-heavy

- **Low-poly only.** Favor low-detail primitives — `IcosahedronGeometry`
  / `SphereGeometry` at low segment counts — over high-subdivision
  meshes. Reuse one geometry where possible.
- **Instance anything repeated.** Knowledge Galaxy (~56 nodes) and
  Framework Orbit (52 spheres) each use a single `<instancedMesh>` —
  one draw call, per-instance color + scale. Never hand-place dozens
  of meshes.
- **Lighting:** at most one key light + one ambient fill. No area
  lights, no IBL/environment probes. Scenes whose meshes use
  `meshBasicMaterial` (color encodes the data directly) ship *no*
  lights at all — that is within the cap.
- **No heavy post-processing** — no bloom / DOF / SSAO stacks, no
  raymarching / SSR / refraction shaders. They are costly on mobile
  GPUs.
- `dpr` is capped at `[1, 1.5]` by `SceneCanvas`; `frameloop` is
  paused off-screen. Scenes don't need to re-implement either.
- Dispose GPU resources (`BufferGeometry`, `EdgesGeometry`) created
  outside JSX on unmount — a `useMemo` returning a disposer, or a
  cleanup effect.
- Keep the per-scene code small — each scene is lazy-loaded inside the
  shared `three` chunk; pages that don't mount a scene pay nothing.

### Data — the props contract

Each scene below lists the typed **props** it reacts to. A per-surface
wrapper derives those props from its data source and passes them down.
A scene must render correctly with every prop omitted (the scene
declares its own defaults) and must **visibly react** when given
different values — that reactivity is the whole point of the layer.

There is no throttling layer (the Spline `setVariable` throttle is
gone) — React re-render batching plus the scene reading props inside
`useFrame` is sufficient. If a Phase-3 data source is chatty, throttle
in the wrapper (e.g. a `staleTime` on the query).

---

## Scene 1 · Command Core

| | |
|---|---|
| **Surface** | Homepage Ultron — `components/ultron/ultron.tsx` (Phase 3) |
| **Wrapper** | `components/3d/command-core.tsx` |
| **Scene** | `components/3d/scenes/command-core-scene.tsx` |
| **Role** | Highest-visibility surface · ambient OS-landing backdrop |

### Geometry

A single rotating geometric **core** — a faceted low-poly polyhedron
(the scene uses an `IcosahedronGeometry` at detail 0 — 20 faces), gold
wireframe edges over a dark, semi-transparent interior. "The core of a
power source, contained." It sits *behind* the homepage data overlay
(the wrapper mounts as an absolute, negative-z backdrop), so it must
never compete for attention: dim, deep, and slow.

- One central mesh group, roughly 30% of the viewport's smaller
  dimension. No orbiting satellites, no scene clutter.
- Gold (`#FDB913`) edges (`lineSegments` over an `EdgesGeometry`);
  interior face mesh in `--bg-base`, semi-transparent.
- No floor, no shadow plane.

### Idle animation

- Slow Y-axis rotation, ~50s per revolution. A near-imperceptible X
  drift so it never reads as a flat spin.
- A gentle ~4s emissive pulse on the wireframe edges, synced in feel
  to the app's `pulse-live` keyframe.

### Data-reactive behavior + props

| Prop | Type | Range | Drives |
|---|---|---|---|
| `healthScore` | `number` | 0–100 | Core integrity — 100 = whole, bright, stable; lower = edges flicker (pulse troughs deeper), interior emissive dims. |
| `alertLevel` | `"info" \| "warn" \| "critical"` | — | Edge color — `info` = gold, `warn` = `--gold-dim` amber, `critical` = `--status-red` rim. |
| `situationCount` | `number` | 0–n | A faint scale-pulse depth — more active items = a slightly deeper breath. |

Phase-3 source: `/api/ultron/situation` (the existing aggregator).

---

## Scene 2 · Knowledge Galaxy

| | |
|---|---|
| **Surface** | `app/(mastery)/brain/galaxy/page.tsx` (Phase 3) |
| **Wrapper** | `components/3d/knowledge-galaxy.tsx` |
| **Scene** | `components/3d/scenes/knowledge-galaxy-scene.tsx` |
| **Role** | The flagship scene · replaces the existing SVG galaxy |

### Geometry

A real 3D **node constellation** — brain-memory records as a cloud of
small glowing spheres in a flattened 2-arm spiral disc (a galaxy
shape, not a pure sphere cloud), with faint connecting lines between
near neighbors.

- 56 **instanced** low-poly spheres — ONE `<instancedMesh>`, not
  hand-placed meshes. `memoryCount` decides how many are "lit".
- Per-instance color = that node's confidence: bright `--gold` = high
  confidence, `--gold-dim` = low. Sphere size keyed to recency in
  3 tiers (per-instance scale). The mesh uses `meshBasicMaterial` —
  the color *is* the signal, so it needs no lighting.
- Thin, low-opacity gold `lineSegments` connect nodes within a
  proximity threshold — semantic neighborhoods. Link count is capped.
- A faint dark depth-haze plane toward the back for parallax depth.
  **No violet.**
- The layout is generated from a seeded PRNG so it is stable across
  renders (no re-roll on every mount).

### Idle animation

- The whole constellation drifts — a very slow Y rotation (~60s) plus
  a gentle per-node bob so it feels alive, not frozen.
- Subtle twinkle on node scale (de-synced sine per node).

### Data-reactive behavior + props

| Prop | Type | Range | Drives |
|---|---|---|---|
| `memoryCount` | `number` | 0–n | How many of the 56 nodes are lit / how dense the visible cloud reads. |
| `topConfidence` | `number` | 0–1 | Brightness ceiling — scales the brightest nodes' color intensity. |
| `axisShift` | `number` | 0–1 | Drift intensity — per-node bob amplitude; how much the constellation re-arranges when the 8-axis self-model shifts. |

Phase-3 source: the brain-memory data source.

---

## Scene 3 · Framework Orbit

| | |
|---|---|
| **Surface** | `app/(mastery)/system/lens-stats/page.tsx` — **already mounted** |
| **Wrapper** | `components/3d/framework-orbit.tsx` |
| **Scene** | `components/3d/scenes/framework-orbit-scene.tsx` |
| **Role** | Strategic-AI telemetry anchor, above the top-frameworks table |

### Geometry

**52 small spheres orbiting** a central point — one sphere per
strategic-frameworks lens (Pareto, OKRs, First-Principles, …). It
reads like a particle accelerator seen from the side: a system in
motion. This scene lives *inside a `<GlassCard>`* above the existing
table — it must not eat the page (the page mounts it at a fixed
~280px height).

- A small, calm central anchor — a dark-gold core sphere representing
  the registry. This is the one lit mesh (a `meshStandardMaterial`).
- 52 **instanced** low-poly spheres (ONE `<instancedMesh>`) on varied
  orbital radii and inclinations — organic, not concentric rings —
  with per-instance color and scale.
- Top 3 firers: `--gold`, large (up to ~3× base). Middle tier:
  `--gold-dim`, medium. Long tail: `--text-tertiary` gray, small.
- No background detail.

### Idle animation

- Each sphere orbits the center on its own period (~8–30s for a full
  revolution); inclinations vary so the cloud has 3D depth.
- A faint ~3s pulse on the central anchor.

### Data-reactive behavior + props

| Prop | Type | Range | Drives |
|---|---|---|---|
| `topFirerSize` | `number` | 0–1 | Scale of the #1 most-fired lens sphere (linear interp base → ~3×). |
| `secondFirerSize` | `number` | 0–1 | Scale of the #2 lens sphere. |
| `thirdFirerSize` | `number` | 0–1 | Scale of the #3 lens sphere. |
| `fallbackRate` | `number` | 0–1 | System-wide lens-fallback proportion — above ~0.3 the central anchor pulses `--status-red`: a visual alert that lens routing is degraded. |

Phase-3 source: `/api/system/lens-stats`.

---

## Scene 4 · AI Pulse

| | |
|---|---|
| **Surface** | `app/(mastery)/chat/page.tsx` status strip (Phase 3) |
| **Wrapper** | `components/3d/ai-pulse.tsx` |
| **Scene** | `components/3d/scenes/ai-pulse-scene.tsx` |
| **Role** | Smallest scene · most-touched surface · pulses with AI work |

### Geometry

A tiny living **indicator** — a single small faceted shape (the scene
uses a flat-shaded low-poly `IcosahedronGeometry`) that lives in the
chat status strip. Small footprint: a status indicator with depth,
not a centerpiece. It gives the operator a peripheral signal of
whether the AI is healthy.

- One outer mesh, gold, emissive, lit from one side. Designed to read
  at a small render size (~32–64px).
- A faint inner core mesh pulsing slightly out of phase with the
  outer shell — the "living" read.

### Idle animation

- A slow breathing pulse — scale ~0.95 ↔ 1.05. The pulse *frequency*
  is the data-reactive part (see `pulseSpeed`).
- A slow Y rotation, ~1 revolution per 8s.

### Data-reactive behavior + props

| Prop | Type | Range | Drives |
|---|---|---|---|
| `pulseSpeed` | `number` | 0–1 | Pulse rate — 0 = slow idle breath (~0.5 Hz), 1 = rapid pulse (~3 Hz) while the AI is actively streaming. The frequency is integrated as a phase so a speed change is seamless, never a jump. |
| `colorIndex` | `0 \| 1 \| 2` | — | Mesh color — `0` = gold (`#FDB913`, normal idle/active), `1` = a brighter gold "AI working" tint, `2` = `--status-red` (error/stalled). All inside the gold-on-dark family except the red error state — **no purple**. |

Phase-3 source: the chat AI-activity telemetry (provider, latency,
streaming state).

---

## Extending or adding a scene — checklist

- [ ] The scene is a component under `components/3d/scenes/`, mounted
      by a wrapper through `<SceneCanvas>`.
- [ ] Geometry is low-poly; anything repeated uses `<instancedMesh>`.
- [ ] Materials are `meshStandardMaterial` (lit) or `meshBasicMaterial`
      (color-encodes-data) — no raymarching / SSR / refraction.
- [ ] Lighting: ≤ 1 key + 1 fill, or none if all meshes are basic.
- [ ] No purple / violet anywhere. Accent is gold; status is green/red.
- [ ] No pure `#000000`; the void is `#050505`.
- [ ] Idle motion via `useFrame` — 40–60s rotation, 3–5s pulse.
- [ ] Camera is declared with drei's `<PerspectiveCamera makeDefault>`
      inside the scene — NOT set via `useFrame` (a `useFrame`-set
      camera is wrong under the `"demand"` / `"never"` frameloop modes
      `SceneCanvas` uses).
- [ ] The scene reads correctly with all props omitted, and visibly
      reacts to different prop values.
- [ ] GPU resources created outside JSX are disposed on unmount.
- [ ] `pnpm typecheck` and `pnpm lint` are both green.

## Iteration loop

Editing a scene is editing a React component — change the file, run
`pnpm typecheck && pnpm lint`, and the scene updates with the app's
normal build. No external editor, no asset export, no redeploy step
beyond the standard one. This is the payoff of choosing R3F over
Spline: the scene is code, in the repo, reviewable in a diff.
