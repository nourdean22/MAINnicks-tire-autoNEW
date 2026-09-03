# Track 8 — Workspace / Artifacts / Doc Generation / UI-UX (verified 2026-09-03)

Licenses read from actual `LICENSE` file contents, **not** GitHub's classifier — which returns
`NOASSERTION` on exactly the ones that matter.

## A1. Editor stacks
| Project | License (verified) | Latest | Stars | Verdict |
|---|---|---|---|---|
| ProseMirror (`prosemirror-view`) | MIT | 1.42.3 · 2026-08-24 | 8.7k | AUGMENT (via Tiptap) |
| **Tiptap** | MIT core | 3.31.2 · 2026-09-03 | 38.3k | **KEEP** (fallback) |
| Lexical | MIT | 0.50.0 · 2026-09-02 | 23.8k | **WATCH** — still 0.x after 5 years |
| BlockNote | **MPL-2.0 core / GPL-3.0 `xl-*`** | 0.54.0 · 2026-08-13 | 10.1k | **AUGMENT w/ carve-out** |
| **Plate** | **MIT** (verified incl. sub-packages) | 53.3.9 · 2026-08-24 | 16.6k | **KEEP — strongest stack fit** |
| Univer (sheets/docs/slides) | Apache-2.0 core / `@univerjs-pro/*` commercial | 0.25.1 · 2026-06-27 | 14.3k | WATCH |

**Tiptap licensing — half the panic is true, and the true half doesn't bite.** Core + all editor
extensions are MIT. **2025-06-06 Tiptap MIT-licensed 8 formerly-Pro extensions** (Details, Emoji,
DragHandle, FileHandler, InvisibleCharacters, Mathematics, TableOfContents, UniqueID). Still paid:
only clients for Tiptap's *hosted services* — Comments, Snapshots, Content AI, Conversion — shipped
from a **private registry requiring an auth token**, not public npm.
⚠ **The trap is architectural, not legal:** design around Tiptap Comments or Conversion and you've
bought a permanent SaaS dependency for features you can self-build.

⚠ **BlockNote's real trap:** root LICENSE says MPL-2.0 *"except for the XL packages"*, which are
**GPL-3.0 or commercial**. The XL list is `xl-ai`, `xl-ai-server`, **`xl-docx-exporter`,
`xl-odt-exporter`, `xl-pdf-exporter`, `xl-typst-exporter`, `xl-email-exporter`**, `xl-multi-column` —
**precisely the export surface needed**, plus AI and multi-column. **GPL-3.0 on a linked npm package
is fatal for a closed-source app.** MPL-2.0 core is fine.

**Recommendation: Plate primary, Tiptap fallback.** Plate is MIT throughout, its component layer is
**built on shadcn/ui + Radix** (near-zero impedance with the existing stack), and it ships
first-class `packages/ai`, `packages/comment`, `packages/suggestion`, `packages/docx-io`,
`packages/excalidraw`, `packages/markdown`, `packages/diff` **under MIT — which Tiptap charges for.**

## A2. Local-first sync — the honest answer
| Project | License | Latest | Verdict |
|---|---|---|---|
| Yjs | MIT | 13.6.32 · 2026-08-04 | **KEEP — editor-local only** |
| Automerge | MIT | 3.4.1 · 2026-08-12 | WATCH |
| Loro | MIT | 1.15.1 · 2026-08-29 | WATCH |
| ElectricSQL / PowerSync / Zero | Apache-2.0 | active | WATCH (all overkill) |
| Jazz | MIT | 0.20.19 | **DO NOT USE** — 181 stars, single vendor |
| **Triplit** | ⛔ **AGPL-3.0-only** | **npm 2025-07-31 (13mo)**, repo 2026-01-19 | ⛔ **DO NOT USE — double disqualification** |

> **You almost certainly do not need a CRDT sync engine, and adopting one is the most likely way to
> waste a quarter.** CRDTs solve concurrent editing by *distinct actors*. One operator on a phone and
> a desktop is **sequential** editing with occasional offline divergence — a last-write-wins problem,
> not a merge problem. The rare genuine conflict is better resolved by **showing both versions and
> letting you pick** than by silently character-merging into a semantically incoherent interleaving.
> The cost is permanent (tombstones + history forever; Loro ~320 kB WASM + ~50 ms init), and it
> doesn't compose with Neon — a CRDT layer is a *second source of truth* that must be reconciled
> with your relational data, cron jobs, and server-side agents. **That reconciliation is where these
> projects go to die.**

**Three-tier rule instead:**
| Tier | Mechanism | Use for |
|---|---|---|
| 1. Server-authoritative + optimistic UI | Neon + TanStack Query optimistic mutations + `updated_at` LWW + per-row `version` for stale-write detection | **~95% of the app** |
| 2. Per-document CRDT, **editor only** | **Yjs** `Y.Doc` bound to Plate, persisted as a binary blob column, `y-indexeddb` offline | The one genuine case: not losing keystrokes when the phone drops connectivity. **Do not let Yjs become app state** |
| 3. Explicit conflict UI | two-version diff + keep-mine/keep-theirs/merge | Divergent offline edits. **A feature, not a failure** |

## A3. Canvas / diagrams / code
| Project | License (verified) | Verdict |
|---|---|---|
| **Excalidraw** | **MIT** (LICENSE read) | **KEEP — embed** |
| **tldraw** | ⛔ **Proprietary** (`SEE LICENSE IN LICENSE.md`) | ⛔ **DO NOT USE** |
| Mermaid | MIT | **KEEP — embed** |
| Monaco | MIT | **REPLACE** — no supported mobile/touch story, ~5 MB |
| **CodeMirror 6** | MIT | **KEEP** — modular, real touch/IME support |
| **Shiki** | MIT | **KEEP** — static HTML, zero client editor cost |
| Marimo | Apache-2.0 | **DELEGATE** — it's a server + kernel |

⛔ **tldraw is the biggest license trap in this report.** Multiple 2026 blog posts still claim "tldraw
core is MIT." **It is not.** Default terms permit use **"only in development."** Production requires a
paid license or a 100-day trial. The hobby tier is **non-commercial only** and forces a visible
watermark. And the SDK contains **technical enforcement**: *"technical measures to verify License Key
validity, detect deployment environments, enforce usage restrictions... and ensure proper watermark
display."* **Your app will phone home and self-police.** Use Excalidraw.

⚠ **Both `prosemirror/prosemirror` and `codemirror/dev` show as ARCHIVED on GitHub — they are
META-repos.** The actual packages ship actively (`prosemirror-view` 2026-08-24, `@codemirror/view`
2026-09-03). Several 2026 "is X dead?" posts misread this.

**Monaco vs CodeMirror is decided by the iOS PWA — not close.** And for **read-only** code/diffs
(most of a trace/diff UI) use **Shiki**: same TextMate grammars as VS Code, rendered to static HTML.
**The single highest-leverage perf decision here: your diff viewer should ship no editor at all.**

## A4. EMBED vs DELEGATE
**Governing principle: embed what must participate in the agent loop; delegate what the operator uses
as a destination.**

| Surface | Decision |
|---|---|
| Rich-text/block docs · markdown+code · diagrams (Mermaid) · **diff/checkpoint review** · terminal (read-mostly) | **EMBED** |
| Freehand canvas (Excalidraw) | **EMBED, deferred** — agents can't meaningfully author on it |
| **Spreadsheets (editing)** · **Slides (editing)** · PDF viewing · notebooks · browser | **DELEGATE** — generate `.xlsx`/`.pptx`, hand off. Grid/slide editing is a multi-quarter project |

*On a phone, an embedded spreadsheet grid is worse than the native app in every dimension. The app's
job on iOS is to **produce artifacts and review them**, not be an office suite.*

## B. Document generation
| Tool | License | Verdict |
|---|---|---|
| **Typst** | **Apache-2.0** | **KEEP — primary PDF target** ⭐ |
| **Gotenberg** | MIT | **KEEP — best ops story** ⭐ |
| WeasyPrint | BSD-3 | KEEP — HTML→PDF |
| Playwright→PDF | Apache-2.0 | KEEP (fidelity path) |
| Pandoc / LibreOffice headless | GPL-2.0 / GPL-3.0 | **KEEP — subprocess only** |
| `docx` (JS) / python-docx / PptxGenJS | MIT | KEEP |
| **ExcelJS** | MIT | **WATCH → REPLACE** — 4.4.0 · **2023-10-19**, ~3 yrs stale |
| **npm `xlsx`** | Apache-2.0 | ⛔ **DO NOT USE from npm** — frozen **0.18.5 · 2022-03-24**; SheetJS left npm for its own CDN; known prototype-pollution/ReDoS advisories |
| **ONLYOFFICE DocumentServer** | ⛔ **AGPL-3.0** | ⛔ **DO NOT USE** — §13 network copyleft triggers on exactly this deployment; container isolation does not help |
| Collabora Online | **MPL-2.0** (LICENSE read — sources calling it restricted were wrong) | **WATCH** — safe license, LibreOffice-core weight |

**GPL is fine at the process boundary.** Pandoc and LibreOffice are safe **as subprocesses** over
CLI/stdin — copyleft attaches to linking and derivative works, not to "my closed program executes
your program." **Do not** link `libreofficekit` or embed Pandoc's Haskell library.

**Typst is the standout and the least-known option:** Apache-2.0, single Rust binary, no system deps,
compiles in **milliseconds**, meaningful errors, and — critically — **exports natively to PNG and SVG
as well as PDF, with no browser and no LibreOffice.** That makes the render half of the validation
loop nearly free, which is what makes running the loop on *every* artifact economical.

### ⭐ B2. Visual validation loops — the section most teams skip
**Syntactic validity is table stakes. OOXML and PDF will happily encode text that overflows its box,
elements that overlap, and content clipped off-canvas. No schema validator catches any of that.**

OSS implementations verified: **microsoft/hve-core** `powerpoint` skill (MIT, 1.4k stars, renders
slides to JPG via LibreOffice then vision-validates overlap/overflow) · **Agents365-ai/drawio-skill**
(MIT, 9.0k stars, **best-documented loop** — reads its own PNG and auto-fixes overlaps/clipped labels,
capped at **5 rounds**) · **icip-cas/PPTAgent** (MIT, 5.0k stars, **PPTEval** vision rubric — take the
*evaluator*, not the generator) · **siril9/presentation-skill** (MIT, 49 stars — **the right
architecture in miniature**: cheap deterministic geometric checks first, then vision on exported JPGs
with a prompt **deliberately biased toward finding problems**).
⚠ **anthropics/skills has NO LICENSE file — read for patterns, do not vendor.**

Research: *"Seeing is Improving"* (CVPR 2026) · DeepPresenter (arXiv 2602.22839) · DECKBench
(arXiv 2602.13318). Emerging term of art: **"rendered-screenshot vision-judge."**

**Two gates, cheap before expensive** — every serious implementation converges on this:
- **Gate 1 — deterministic geometry (no model, free, always).** From the document model: text bbox vs
  container → overflow · pairwise rect intersection → overlap · rect vs page → out-of-bounds ·
  image intrinsic vs frame aspect → distortion · WCAG contrast on every text/bg pair · font-fallback
  events → tofu. **Catches most real defects at zero cost and gives the repair step precise
  coordinates rather than vague prose. Going straight to vision is the mistake that makes the loop
  expensive and vague.**
- **Gate 2 — vision critique on survivors.** Render ≥150 DPI, demand **structured JSON, not prose**.

Four rules that separate a working loop from a token furnace:
1. **Bias the prompt toward finding problems.** "Does this look good?" gets "yes" almost always.
2. **Enumerate a closed violation taxonomy** — text clipping, element overlap, out-of-bounds, image
   distortion, contrast. Free-form critique is unactionable.
3. **Hard-cap iterations at 3 and require monotonic improvement.** If violation count doesn't drop,
   stop and escalate — the model is thrashing.
4. **Repair at the source, never on the pixels.**

## C. UI/UX blueprint
| Project | License (verified) | Verdict |
|---|---|---|
| **assistant-ui** | MIT | **KEEP — best primitive library** ⭐ |
| Vercel AI SDK | Apache-2.0 | KEEP |
| **AG-UI protocol** | MIT | **WATCH** — v0.0.59 pre-1.0; **vendor the types**, align to the event vocabulary |
| LibreChat | **MIT** | **AUGMENT — the one you can freely copy from** |
| Open WebUI | ⚠ **custom BSD + branding clause** | **WATCH — read only** |
| Lobe Chat | ⛔ **LobeHub Community License** | ⛔ **DO NOT USE as base** |
| Dify | ⛔ **modified Apache-2.0** | ⛔ **DO NOT USE as base** |
| **cmdk** | MIT | ⚠ **WATCH — npm 1.1.1 · 2025-03-14 (18mo stale)**; shadcn's `Command` depends on it |

⛔ **Lobe Chat:** *"a commercial license must be obtained from the producer if you want to develop and
distribute a derivative work."* **Your app IS a derivative work if you fork it.**
⛔ **Dify:** bans multi-tenant without authorization and bans **removing or modifying the LOGO**.
⚠ **Open WebUI:** *"strictly prohibited from altering, removing, obscuring, or replacing any
'Open WebUI' branding"* — with an exemption only where users **do not exceed fifty (50)** in a rolling
30 days. You'd fall under it, but you'd be building on a license that can tighten.

> **Do not fork any full chat app.** Every one is either license-encumbered or architecturally
> committed to being a generic chat clone — the exact thing you said you're not building.

### Interaction patterns worth stealing (patterns only, no proprietary code/assets)
**Command palette:** ⌘K global, portal-rendered, focus-trapped. **Nested pages, not immediate
execution** — Raycast and Linear *drill into sub-menus*; implement as a **stack of page names**,
Backspace on empty input pops. Verb-first labels. **Show the keybinding on the row** — the palette is
how shortcuts are learned. **Context-scoped commands** — different verbs per focused pane; this is
the difference between a launcher and an OS. **Recency + frequency ranking beats pure fuzzy score.**
A11y: input `role="combobox"` + `aria-activedescendant` — **not roving focus**, DOM focus must stay
in the input.

**Split panes:** `react-resizable-panels` (MIT, v4.12.3). **Never 4 panes on a phone** — collapse to
one pane + segmented switcher, and let the agent **push** the pane that just changed to the front
(the mobile equivalent of peripheral vision). Dividers need `role="separator"` + **keyboard resize**.

**Tool-trace viewer:** collapsed by default, one line per call (`icon · tool · arg summary ·
duration · status`). **Nest sub-agent calls as an indented sub-timeline.** Stream status transitions;
**never let a row sit in `running` without an elapsed counter — a silent spinner is
indistinguishable from a hang.** **Failed calls stay expanded.** Deep-link every step by ID.

**Diff/checkpoint review** — the highest-trust surface: **per-hunk accept/reject, not per-file**
(file-level "approve all" is how bad changes ship) · split on desktop, unified on mobile · semantic
summary above the diff · checkpoints as a first-class timeline with **a preview of what restoring
would discard** · render with Shiki · **never colour alone** for +/−.

**Approval queues:** **show the exact effect, not the intent** — "Run `rm -rf ./dist`", not "clean
build artifacts"; the whole point is that description and action might disagree. Risk-tier the queue.
**Batch related approvals into one card with individual toggles** — ten sequential prompts trains you
to tap Approve without reading, the exact failure the queue exists to prevent. **Undo window > confirm
dialog** wherever reversible.
🔴 **iOS standalone PWA silently suppresses `window.confirm/alert/prompt` — every native confirm
becomes an unconditional cancel, so destructive actions silently no-op while the operator believes
they succeeded.** Every gate must be in-DOM. **Audit for `confirm(`/`alert(`/`prompt(` in CI — this
bug class is invisible in desktop testing.**

**Task queues:** group by state · elapsed on running, **absolute timestamps on finished** · **stalled
detection** (no event for N× median → amber) · **distinguish `superseded` / `partial` / `failed` as
separate states — a `partial` rendering as green is how a 1,237-run cron storm goes unnoticed** ·
**never render a failed read as a confident zero** (found 10× in the /brain audit): every metric needs
*value*, *empty*, and **a visually loud *unavailable***.

**Cost meters:** ambient not modal · **show budget remaining, not spend accumulated** (remaining
drives behaviour, accumulated drives anxiety) · per-turn cost inline, dimmed · threshold alerts only.

**Memory/context inspectors:** show **what was actually injected**, with per-block token counts and a
budget bar — the most-requested and least-built feature in agent UIs. Every memory row editable and
deletable in place with provenance. **Surface the context ceiling and what got evicted.**
**Given the 24-of-181 tool budget: show which tools were available this turn and which were filtered
out, and why. A capability gated by a regex before the model reasons should be visible as gated, not
absent.**

### Accessibility (WCAG 2.2)
⚠ **Token-by-token `aria-live` updates make screen readers unusable.** Buffer and announce at
sentence/paragraph boundaries, or put `aria-live` on a separate summarizing region and mark the
streaming text `aria-hidden` until settled. Use `polite`, **never `assertive`**. Set `aria-busy`.
New in 2.2: **SC 2.4.11 Focus Not Obscured** (a fixed bottom composer is the classic violation) ·
**SC 2.5.7 Dragging Movements** (every drag needs a non-drag alternative) · **SC 2.5.8 Target Size
≥24×24 CSS px** (critical for dense mobile trace rows). **On a new message: do not steal focus** —
announce via live region + a "jump to latest" control.

### iOS PWA — accurate as of Safari 26.x
| Capability | Actual status |
|---|---|
| Installability | **Safari 26.0 removed ALL installability requirements** — every site added to Home Screen opens as a web app by default |
| Install prompt | ❌ **No `beforeinstallprompt`** — teach it with an in-app coach-mark |
| Web Push | ✅ **only when installed to Home Screen**; a Safari tab cannot receive push |
| Declarative Web Push | ✅ since Safari 18.4 — notification **without a service worker** |
| **Silent/background push** | ❌ Not supported. Push **must** be user-visible |
| **Background Sync / Periodic Sync** | ❌ **Not supported. Still.** |
| **Storage quota** | ⚠ **The "50 MB" figure is OBSOLETE** (pre-Safari 17). Home Screen web apps get the **same origin quota as the browser — up to ~60% of disk per origin** |
| `persist()` | Granted on heuristics *"like whether the website is opened as a Home Screen Web App"* — favourable, **not guaranteed** |
| EU status | ✅ **PWAs work normally** — Apple reversed the Feb-2024 removal on **2024-03-01**. Posts claiming otherwise are stale |
| Login | ⚠ **Separate storage jar from Safari — you WILL be logged out on first launch** |

**Architectural consequences:** (1) **No background sync ⇒ the server must be the scheduler.** Never
plan work requiring the PWA to wake. (2) **No silent push ⇒ every message costs attention** —
cooldowns and combining are the whole budget, not polish. (3) **The storage news is good and
under-exploited** — ~60% of disk makes aggressive offline caching of artifacts/traces viable, which
**further undercuts the case for a CRDT engine**.

## The three highest-leverage findings
1. **tldraw is not MIT** and enforces licensing in code. If it's in the app, it comes out or gets paid for.
2. **Typst (Apache-2.0) with native PNG export** makes the visual validation loop cheap enough to run
   on every artifact — the thing that turns "syntactically valid" into "professional quality."
3. **CRDT sync is the wrong tool for one operator.** Scope Yjs to the editor buffer, keep Postgres
   authoritative — saves a quarter and gives a *better* conflict experience than automatic merging.
