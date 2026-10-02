# Surfaces — Chat, Home, core workspaces, component disposition

Deliverables E, F, G, H. Everything here is written against the real components (paths given) so the
next session can tell what is shipped, what is specified, and what is deliberately deferred.

## E · Chat — the centrepiece

**Feeling:** "I am operating my system through intelligence," not "another chatbot."

### E1 · Canvas (`features/chat-v2/components/chat-island.tsx`, `chat-message-list.tsx`)

| Region | v1 (production) | v2 |
|---|---|---|
| Header | `NICK` + capability pill + 3 bordered uppercase buttons | `NICK` wordmark (mono, 13px) · one status pill `● LIVE · OWNER` built from posture/depth/private (details on tap) · three *icon* buttons at 44px, no borders, no uppercase labels; active state = accent-soft fill + signal notch |
| Reading column | `max-w-4xl` for everything | `max-w-[76ch]` prose column; tool receipts, tables and code may use the full `max-w-5xl` (`[data-wide]`) |
| User message | `max-w-[88%] rounded-2xl bg-surface px-5 py-3.5` bubble | compact graphite: `--surface-interactive`, `--radius-surface`, 15px, `max-w-[80%]`; accent edge only while editing (`data-editing`) |
| Nick message | bordered `bg-raised/85` bubble | **no bubble**: 16px/1.6 editorial prose in the column, `NICK` mono designation above the first block, markdown hierarchy in `--text-primary` (headings) — gold removed from `h1/h2/strong/th` |
| Reasoning | zinc debugger card, "Deep Reasoning in progress…", raw JSON detail | **Activity Summary**: working → `◌ Working · 11s · Searching` (one line, amber pulse only while working); done → `✓ Worked 18s · 6 steps`; expanded → timeline rows `label · elapsed · ✓`; developer detail (raw step data) behind a mono `Developer detail` toggle |
| Tool receipt | left-bordered colour card, uppercase display label, raw-JSON expander | **Tool Receipt**: `[icon] Action label` / `primary result` / `next action →`, state glyph `◌ ✓ ! × ?`, hue only on the glyph and left notch, raw output under `Developer detail` |
| Tool receipt summary | bordered strip under message | plain mono footer line `✓ 4 tools · 2 writes · trace` (same data, no box) |
| Quality bar / citations | 9px mono bordered strip | 11px mono footer `7 sources · quality ok`, expands to the same `QualityBar` body |
| Composer | `rounded-2xl shadow-2xl` glass, gold focus ring, 2 permanent square buttons | material shell (`.ui-material`, `--radius-overlay`), no 2xl shadow; focus = 1px accent edge + L1 lift; `+` attach · voice · send; slash and mention menus attach spatially |
| Empty state | gold mono eyebrow + 4 bordered command cards | `NICK` mark, one sentence, four *rows* (no cards) with a single notch on hover |
| Jump to latest | bordered circle | material circle, same behaviour (geometry test unchanged) |

### E2 · States that must look different (pinned in `/system/chat-states` and the UI Lab)

composer: idle · focused · attachment · slash · mention · voice-listening · sending · streaming · queued · editing · offline · disabled.
turn: streaming (no actions row) · complete · truncated · refused · interrupted · side-effecting (no Regenerate).
tool: queued · awaiting approval · running · complete · warning · failed · denied · cancelled · unknown.

### E3 · Approvals
Risk-weighted: a low-risk confirmation stays a receipt row with two text buttons; a high-risk one gets a
raised surface (`--surface-raised`, L1) with WHAT / WHERE / WHY / IMPACT / REVERSIBILITY lines and a filled
accent Approve beside a plain Reject. (Spec; the existing `mega-confirm-dialog` is the runtime — restyle only.)

### E4 · Evidence
Collapsed footer `7 sources · 3 live systems · 2 memories`; glyph per kind (web ⌁ · system ◇ · memory ◈ ·
repo ⌥ · operator ● · inference ∿ · unknown ?), no rainbow. Existing `CitationPills` / `EvidenceMark` stay the
runtime.

### E5 · Context / memory inspector (`components/chat/memory-inspector-sidebar.tsx`)
Desktop: right dock on `--overlay`, `--edge-default` left edge, Geist headings (no display uppercase).
Phone: bottom sheet through the Dialog runtime (already the contract). Secondary by construction: it
never consumes chat width unless open.

### E6 · Artifact / workspace (phase 1)
A completed Nick turn whose body exceeds ~1,800 characters or contains a table/code fence ≥ 20 lines renders
an `Open workspace` affordance in its footer. Phase 1 opens the existing inspector with the message as the
object (desktop dock / phone sheet). A dedicated split canvas is **deferred** until the inspector path is
measured in use.

## F · Home (`components/home/*`)

Keep `operator.brief` and the six sections. Visual recomposition only:

| Section | v1 | v2 |
|---|---|---|
| State line | mono date · `NOW` eyebrow · 68px uppercase verdict | mono date · `NOW` notch + eyebrow · verdict stays Barlow (the page's one shout) at 30/40/48px |
| The brief | gold left rule · Barlow uppercase CTA | accent notch instead of a full-height gold rule · Geist 600 CTA in accent fill (`--radius-control`) · "Why this?" / "Different move" as quiet text buttons |
| Nick command line | bordered command bar | material shell, same behaviour |
| Needs judgment | eyebrow + 30px rose Barlow count | eyebrow + 20px tabular Geist count in rose; rows unchanged |
| Horizon / change | hairline rail | hairline rail kept (it is the one place a separator earns its keep) |
| Momentum | — | **deferred**: "3 things moved today" needs a server source that exists (`operator.brief` carries `changes`, not counts); wiring a count without a measured source would violate rule 6 |

## G · Core workspaces (density is a page decision)

| Surface | Density | v2 change in this wave | Later |
|---|---|---|---|
| Missions | dense operation | mission titles → Geist 600 18/20px sentence case; gold drag handles → muted; row meta mono 12px | row/inspector table mode |
| Brain | exploratory | inherits tokens + type; no structural change | graph restyle |
| Stats | analytical | inherits; `.stat-number` keeps Barlow | direct-labelled charts |
| System | diagnostic | inherits; mono stays prominent here by design | — |

## H · Component disposition

| Component | Verdict | Note |
|---|---|---|
| `StandardPage` | KEEP structure · RESTYLE | drop universal `page-fade-in`; header scale from base.css |
| `PageHeader` (`layout/ui.tsx`) | RESTYLE | `components/layout/page-header.tsx` is a second, unused PageHeader → DELETE (zero importers) |
| `DesktopSpine` | RESTYLE strongly | 60px, icon-led, Base UI tooltips, signal notch, material; contract test selectors preserved |
| `BottomTabBar` | KEEP architecture · RESTYLE | Geist labels, notch, material; `aria-label="Primary"` and ticker order preserved |
| `BottomPulseTicker` | RECOMPOSE (later) | keep for this wave — removing it changes the bottom-chrome contract six tests pin; quiet its tone first |
| `MoreSheet` | RESTYLE | gold top edge → `--edge-default`; search row no gold |
| Command palette | KEEP · RESTYLE (later) | shadcn `command.tsx` — material + shortcut hints next wave |
| Dialog / Base UI runtime | KEEP | |
| Inspector (`inspector-frame.tsx`) | KEEP · RESTYLE | eyebrow → mono 11px, body type Geist |
| `ChatIsland` header | RECOMPOSE | see E1 |
| `ChatMessageList` runtime | KEEP · RESTYLE presentation | widths, bubbles, footers |
| `NickMessage` internals | KEEP | markdown component map re-coloured only |
| Message shells | KEEP | |
| `ChatComposer` behaviour | KEEP · presentation REPLACE | |
| `ReasoningTraceLive` data | KEEP · UI REPLACE | becomes `ActivitySummary` |
| `tool-result-registry.tsx` | KEEP | semantics untouched |
| `ToolResultCard` | REPLACE renderer | Tool Receipt grammar, same props |
| `QualityBar` / `MessageDiagnostics` | KEEP · COMPRESS | footer line |
| `MemoryInspectorSidebar` | RESTYLE | |
| `HomeConsole` contract | KEEP · composition RESTYLE | |
| `Panel` / `.panel` | RESTYLE | flat surface, no gradient, no gold line |
| `.glass-card` / `GlassCard` | RETIRE progressively | renders solid now; 47 adopters migrate when touched |
| `effects.css` dead classes | DELETE | 63 selectors removed (census in README §A1 row 5) |
| `NeuralBackground` canvas | KEEP for now | reduced-motion already disables it; measure its paint cost before deleting (it is the ambient "alive" layer) |
| `AmbientAura` | KEEP | state auras are box-shadow-only and test-pinned |
