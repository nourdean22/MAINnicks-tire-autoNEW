# StateNour (bdnick.info) — PWA/Device, Performance, Accessibility, Observability Audit

**Scope**: Read-only, static-code audit of a git archive of `origin/main @ abdd99395` (apps/statenour),
snapshotted to a scratch directory. No build, no runtime measurement, no network access performed.
Next.js 16.2 App Router, React 19, Tailwind 4, @base-ui/react 1.3, TanStack Query 5 + react-virtual 3,
recharts 3, streamdown + katex + mermaid, sonner, zustand 5, three/@react-three (parked island).

**Evidence classes**: **A** = verified directly in code (path:line quoted) · **H** = inference from code
(pattern implies behavior, not directly observed) · **I** = not verified in this audit (grep found
nothing, or file not reached) · **U** = unmeasured quantity (would require a running app / browser /
bundler) · **C** = live fact supplied by the task brief (production observation, 2026-09-02).

**Method note**: absence claims name the grep corpus and pattern searched, plus a positive-control count
where one is feasible, per operating policy (no ratio without a stated denominator).

---

## 1. PWA AND DEVICE

### 1.1 Manifest — the source that ships is NOT app/manifest.ts (Class A, high-value finding)

Next.js App Router's `app/manifest.ts` (`apps/statenour/app/manifest.ts`) generates a route at
`/manifest.webmanifest`. This repo **also** ships a static file at the identical path,
`public/manifest.webmanifest`. Static files under `public/` are served ahead of generated App
Router routes at the same path, and the LIVE FACTS given for this audit (name "NOUR OS", theme
`#FDB913`, icons 192/512 maskable + apple-touch) match **`public/manifest.webmanifest`** exactly,
not `app/manifest.ts`. `app/layout.tsx:45` explicitly links `manifest: "/manifest.webmanifest"`,
so this isn't ambiguous — the browser is being pointed at the shadowed path on purpose, and the
static file wins.

| Field | app/manifest.ts (dead) | public/manifest.webmanifest (LIVE, class A+C) |
|---|---|---|
| name | STATENOUR | NOUR OS |
| short_name | STATENOUR | NOUR |
| theme_color | #07090e | #FDB913 |
| background_color | #07090e | #050505 |
| icons | one 48x48 favicon.ico | 192/512 PNG any maskable + 180x180 apple-touch |
| shortcuts | HQ / Chat / Journal / Health (4 entries) | none |
| scope | unset | / |

Consequence: app/manifest.ts is dead code that misleads. A developer editing it — the canonical,
typed, IDE-discoverable place to change a Next.js manifest — will ship a change that never reaches
a browser, including the four shortcuts entries (long-press home-screen quick actions to
HQ/Chat/Journal/Health), which exist in code but not in production. public/manifest-mobile.json
(name "NOUR OS", start_url "/m", single SVG icon) is a third manifest file with no
`<link rel="manifest">` or reference anywhere in app/ or components/ (grep corpus: app, components,
lib; pattern manifest-mobile; 1 hit besides the file itself, a path string inside
tests/security/middleware-boundary.test.ts) — also unreachable, apparently an abandoned /m
mobile-entry experiment.

Both live manifest files declare orientation "portrait" and display "standalone", matching the
LIVE FACTS. app/layout.tsx:56-63 separately declares Next.js head icon links (192/512 +
apple-touch-icon) that DO match the live manifest's icon set — so the head tags and the static
manifest agree; only app/manifest.ts disagrees with both.

### 1.2 Service worker — registration, lifecycle, update flow

- Registration: components/hud/sw-register.tsx:16-36. Client component, mounted in root
  app/layout.tsx:98 (every route, not just (mastery)). Registers /sw.js after window load (never
  competes with first paint); registration failure is caught and silently swallowed — correct
  defensive posture for a non-critical enhancement, but it also means a broken SW registration
  produces zero observable signal anywhere (no recordError, no toast, nothing in /system/errors).
  A regression here (e.g. a future precache list that 404s) would be invisible until someone
  thinks to check the Application panel by hand.
- Lifecycle (public/sw.js:16-29): self.skipWaiting() unconditionally on install (line 18),
  self.clients.claim() on activate (line 28), old cache versions purged on activate
  (lines 22-27). This is the auto-activate pattern — there is no postMessage-based
  SKIP_WAITING gate, no registration.waiting check, and no controllerchange listener anywhere in
  the client (grep corpus: app, components; pattern controllerchange; 0 hits) to prompt a reload
  once a new SW takes over.
  Stale-shell risk (H): because navigations are network-first and nothing HTML is cached (fetch
  handler below), a fresh page load always gets the current deploy — there is no stale-HTML risk
  on reload. The real risk is the already-open tab: on a phone-installed PWA that stays open for
  hours, a deploy replaces the controlling SW mid-session with no user-visible prompt. The
  already-loaded JS/React tree keeps running unchanged (skipWaiting/clients.claim only affects
  future fetches through that SW, not in-memory code), so this is lower-risk than a classic
  stale-shell bug, but any client code that lazily imports a chunk after the deploy can 404
  against the old build's manifest until the tab is manually reloaded. No mechanism surfaces "a
  new version is available" to the operator.
- Version bump mechanism: manual. CACHE_NAME = 'nour-os-v10' (public/sw.js:14) is a hand-edited
  string; there is no build-time injection of a content hash or package.json version. Because the
  fetch handler only cache-busts naturally-content-hashed /_next/static/... files, forgetting to
  bump CACHE_NAME on a sw.js logic change (not an asset change) is the actual risk — old and new
  SW logic would coexist across tabs until the cache-name literal changes.
- Fetch handler (public/sw.js:32-73): cache-first for /_next/static/ and content-hashed
  extensions only; navigations are network-first with an inline (not cached) offline fallback HTML
  string; every /api/* request and every non-GET request bypasses the SW entirely (return at line
  33 and 35) — confirms the LIVE FACTS description exactly. No app shell is precached (line 16
  comment: "no precache"), so there is no offline-capable shell for Home, Chat, or Missions —
  see 1.9.

### 1.3 Push notifications

- Client subscribe entry points: components/hud/sw-register.tsx (registration only) and
  hooks/use-push-notifications.ts (the actual pushManager.subscribe() caller — located via grep,
  not read line-by-line this pass).
- Server routes: app/api/notifications/subscribe/route.ts — GET returns the VAPID public key
  (line 9-12), POST validates subscription.endpoint/keys.p256dh/keys.auth and calls
  saveSubscription (line 14-29, requireSession gated), DELETE calls removeSubscription (line
  31-42, also requireSession gated).
- VAPID env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT — declared in lib/env.ts:74-75
  (runtime tier) and read in lib/notifications/push.ts:31-33. VAPID_PUBLIC_KEY has a hardcoded
  fallback in source (line 31, intentional — it's the public half). VAPID_PRIVATE_KEY does not
  fall back; lib/notifications/push.ts:305-317 documents that it used to (a hardcoded private key
  literally shipped in source, "Wave 58") and was fixed to refuse-and-log instead — the fix is
  present and the old hardcoded value is gone from this file (verified: grep for the literal
  string once quoted in the comment found no match outside the comment itself).
- Storage — no dedicated device/subscription table: push subscriptions are NOT modeled as a Prisma
  model (grep corpus: prisma/schema.prisma; pattern model.*(Device|PushSubscription|Subscription);
  only hits are SmartDevice/DeviceEvent/DeviceCommand, which are the IoT camera/device-bridge
  models, unrelated). Instead lib/notifications/push.ts:120-160 stashes each subscription as a
  JSON blob inside the generic UserPreference key-value table, keyed
  push_subscription_${hashEndpoint(endpoint)} (hashEndpoint is a 32-bit rolling hash,
  push.ts:342-351 — a dedup key, not a security boundary). Reads are
  "WHERE key LIKE 'push_subscription_%'" (push.ts:151-160). There is no userId/tenant column on
  the row — consistent with this being a single-operator app, but it means the push fan-out has no
  concept of "whose device" beyond the endpoint itself.
- Send path (lib/notifications/push.ts:166-296): context-aware quiet hours (no low/medium 9pm-7am
  America/New_York, no low 8-11am unless critical — lines 168-181), per-tag cooldown via an
  auditEvent lookback rather than a counter table (lines 188-214, documented as best-effort:
  concurrent sends can both pass), level-driven TTL/urgency (pushTransportOptions, lines 104-115:
  critical=4h/high urgency, high=12h/high, medium/low=24h/normal|low — this replaced an
  undocumented default 4-week TTL, matching the memory index's note), and 410/404 responses
  auto-removeSubscription (lines 270-273). sendWebPush (lines 300-338) dynamically
  import("web-push"); if the package is missing it degrades to a 501 rather than throwing.
- Notification click routing (public/sw.js:122-149): closes the notification, reads
  event.notification.data.url (default /), and on click either focuses+navigates an existing
  window matching bdnick.info/localhost/127.0.0.1, or clients.openWindow(url). Server-side,
  sendPush's chatSeed mechanism (push.ts:222-234) can override the click URL to
  /chat?q=<prompt>&suggKind=&suggId= so tapping certain alerts (drift, score reminder) lands the
  operator mid-conversation instead of on a bare route.
- iOS silent-push handling: public/sw.js:76-94 — a push event with no event.data still calls
  showNotification with a generic body. The comment (lines 77-82) explains this defends against
  iOS Safari's "silent push" strike counter, which revokes the subscription after repeated no-show
  pushes. Documented reasoning, not independently verified against current iOS behavior — verify
  current platform support before relying on the strike-count claim.

### 1.4 Badge API

components/hud/app-badge.tsx, mounted once at app/(mastery)/layout.tsx:135 (every mastery route).
Polls two tRPC queries — systemAutomation.getPendingApprovals and systemAutomation.approvals —
each refetchInterval: 60_000 / staleTime: 30_000 (app-badge.tsx:28-35), purely to compute a badge
count; renders nothing. navigator.setAppBadge is feature-detected (line 42); the count is never
stamped until at least one query has answered (line 44-45, avoiding a false "0" flash that would
clear a real badge), and is cleared on unmount (lines 53-58). Comment claims "iOS 16.4+ standalone
PWAs support setAppBadge" — verify current platform support rather than trusting the in-source
claim.

### 1.5 Background sync — ABSENT

Grep corpus: app, components, lib, public; patterns sync.register, SyncManager, backgroundFetch,
BackgroundFetch, periodicSync — 0 hits anywhere. public/sw.js has no sync event listener. There is
no Background Sync API usage of any kind.

### 1.6 Wake Lock — present, Missions-scoped

components/missions/execution-panel.tsx:88-113. Real Screen Wake Lock API call
(navigator.wakeLock.request("screen")), requested while a task's status is DOING (an active focus
session) and released on visibilitychange/unmount/cancellation. Every path is try/caught — denial
or absence of the API degrades to "focus session works without it" per the inline comment. The
comment claims "full iOS PWA support since 18.4" — verify current platform support, this audit
did not independently confirm it. Not present anywhere outside this one component (grep corpus:
app, components, lib; pattern wakeLock; 1 file).

### 1.7 Share target, file handlers — ABSENT

No share_target key in either live manifest, no navigator.share() call anywhere (grep corpus: app,
components, lib, public; patterns share_target, navigator.share; 0 hits). No file_handlers
manifest key and no window.launchQueue usage (same corpus; patterns file_handlers, launchQueue; 0
hits). The app cannot receive shared content or files from the OS share sheet.

### 1.8 Camera, microphone, clipboard

**Correction note**: an earlier pass of this audit scoped the getUserMedia/capture grep to
`app`, `components`, `lib` only and wrongly concluded camera/mic were absent. Re-run against the
full tree (including `hooks/` and `features/`, where the real call sites live) found two live
microphone paths and one live camera-capture path. Recorded here as verified, correcting that
earlier gap.

- **Microphone — two independent live features**, both gated by `Permissions-Policy:
  microphone=(self)` (`next.config.ts:107-114`, same-origin only; the header comment states this
  was needed because an empty allowlist silently broke the OpenAI Realtime voice session's
  `getUserMedia` prompt):
  - `hooks/use-realtime-voice.ts:120-121` — `navigator.mediaDevices.getUserMedia({ audio: {...} })`
    for a continuous mic stream feeding the OpenAI Realtime API ("Talk to Nick" voice mode),
    proxied through `app/api/realtime/session/route.ts` + `app/api/realtime/tool-call/route.ts`.
    Rendered via `components/chat/realtime-voice-overlay.tsx`, mounted conditionally
    (`{isVoiceDocked && <RealtimeVoiceOverlay .../>}`) in
    `features/chat-v2/components/chat-island.tsx:312`, which is itself mounted from
    `app/(mastery)/chat/page.tsx` — a live, reachable path, not parked.
  - `hooks/use-voice-input.ts:75-81,198` — a second, simpler `getUserMedia({ audio: true })` path
    for push-to-talk transcription into the compose box, with `getUserMedia` deliberately isolated
    in its own `try` (line 75-76 comment) so a permission denial and a recorder/codec failure
    produce distinguishable errors.
- **Camera — one live native-capture path**: `features/chat-v2/components/chat-composer.tsx:426`,
  a hidden `<input type="file" accept="image/*" capture="environment" title="Capture image from
  camera">` — this is the OS camera-app handoff pattern (opens the device camera app to shoot a
  photo, no `getUserMedia`/live preview in-page), used to attach a photo to a chat message.
  `Permissions-Policy: camera=()` in `next.config.ts:114` fully disables the in-page
  `getUserMedia`-style camera API (for every origin, including self) — consistent with there being
  no live camera *preview* anywhere, only this file-capture handoff, which the Permissions-Policy
  camera directive does not govern.
  Separately, `app/(mastery)/system/camera/page.tsx` (`CameraArrivalsPage`) is unrelated to either
  of the above — a server-mediated ANPR/arrivals dashboard
  (`trpc.system.cameraArrivals.useQuery(..., { refetchInterval: 5000 })`, line 38) reading events
  from the physical camera-bridge integration; it never touches the browser's camera API.
- Clipboard: write-only (navigator.clipboard.writeText, used for copy-to-clipboard actions in
  app/(mastery)/links/page.tsx, components/ai/page-nick.tsx, components/chat/stitch-prompt-card.tsx,
  components/content/assistant-tab.tsx, hooks/chat/use-chat-keyboard.ts,
  hooks/use-nick-message-actions.ts — 6 files). No clipboard read call found (grep corpus: whole
  tree excluding node_modules; pattern navigator.clipboard.read; 0 hits) — the app never pastes on
  your behalf.

### 1.9 localStorage / sessionStorage inventory (Class A — grepped, not exhaustively read)

Grep corpus: app, components, lib, hooks, features; patterns localStorage.setItem/getItem and
sessionStorage.setItem/getItem, non-test files. 30+ distinct localStorage keys, 8 sessionStorage
keys. Grouped by what they hold — none carry credentials, tokens, or API keys (a separate check,
see 4.x observability privacy contract), but several hold plaintext personal content:

**Potentially sensitive plaintext content (unencrypted, client-side only):**
| Key | File:line | What it stores |
|---|---|---|
| DRAFT_KEY (`nour:...` template) | components/journal/reflect-composer.tsx:60 | In-progress JOURNAL entry — {fields, mood, templateKey} as JSON, written on every change, cleared only when the fields go empty |
| draft:${key} | hooks/use-draft-autosave.ts:54,80 | Generic autosave used broadly wherever the hook is wired up — arbitrary in-progress text (journal/chat/etc, consumer-dependent) |
| storageKey(page) (multi-turn) | components/mastery/multi-turn-chat.tsx:60,81 | Recent conversation turns per mastery page, JSON, capped at MAX_TURNS |
| nour:mit-contract | lib/chat/direct-actions.ts:257 | The operator's "Most Important Task" contract text, JSON |
| nour:cognitive-partner-brief (BRIEF_STORAGE_KEY) | lib/home/cognitive-partner-brief.ts:17 | Cached daily brief content/date |
| nour:page-context (STORAGE_KEY) | components/chat/page-context-bridge.tsx:58 | The entity/page context payload chat reads on mount — may include titles/snippets of whatever the operator was viewing |
| chat:seed / chat:pending-seed (sessionStorage) | components/home/brain-node-detail-panel.tsx:149, components/home/home-brain-graph.tsx:753, components/operator/nick-reasoner.tsx:473 | A pre-composed prompt string handed to the next chat load |
| reason:pending-q (sessionStorage) | components/brain/reason-tab.tsx:47 | A pending reasoning question string |

**UI preference / non-sensitive (sort order, toggles, dismissal timestamps, feature flags):**
pins:sortKey, system-actions:sortKey, system-alerts:sortKey, system-crons:sortKey,
system-logs:sortKey, wisdom:sortKey, content-history:sortKey (all via the sort-dropdown pattern in
components/ui/sort-dropdown.tsx + hooks/use-local-storage-state.ts) · nour:kommando:learn-history
(components/actions/mode-learn.tsx:78) · command-palette:recents (components/command-palette.tsx:86)
· nour:hq-last-visit (components/home/change-line.tsx:25) · session-expiry-banner:dismissedAt
(components/hud/session-expiry-banner.tsx:42) · ultron:calibrate:last-shown
(components/journal/memory-calibration.tsx) · nour:stats:collapsed-branches:v1
(components/mastery/character-sheet.tsx:66) · nour:nick-side-pane:open:v1
(components/mastery/nick-side-pane.tsx:38) · nour:haptic-enabled (lib/ui/haptic.ts:22) ·
nour:chat:speed-ribbon (hooks/chat/use-chat-speed-ribbon.ts:27) · nour-pinned-messages
(hooks/use-pinned-messages.ts:18, IDs only) · nour:wisdom-pill-disabled
(hooks/use-wisdom-suggest.ts:81) · nour:dismissed-ticker-items (hooks/use-dismissed-ticker.ts:27) ·
nour:customDomains (hooks/use-custom-domains.ts:27) · nour:pinned-convos
(hooks/use-conversations.ts:303, IDs only) · nour:calibration-explained
(components/ultron/signal/situation-card.tsx:494) · nour:chat:tts + rate
(features/chat-v2/hooks/use-tts.ts:34) · reflect-composer's LAST_TEMPLATE_KEY/EXTRACT_TOGGLE_KEY ·
nour:chat:offline-queue (hooks/use-offline-queue.ts:31 — see 1.10, effectively always empty) ·
pwa-dismissed / risk-warning-dismissed-session (sessionStorage) · a per-tab client ID
(hooks/use-prefetch-client-id.ts, sessionStorage).

**Note on system-alerts:sortKey**: `app/(mastery)/system/alerts/page.tsx:122` writes the value of
a variable named `sortDir` under the key `"system-alerts:sortKey"` (every sibling page writes a
`sortKey`-named variable under that same key name) — H: possibly a copy-paste variable-name
mismatch, not confirmed as a functional bug from static reading alone since `sortDir` may simply
be locally renamed; flagged for a human to glance at, not asserted broken.

### 1.10 Offline behavior — Home, Chat, Missions

No route has a real offline app shell. `public/sw.js` precaches nothing (1.2), so a cold load with
no network serves the SW's inline "Offline. Reconnect to sync." placeholder for ANY navigation,
regardless of route — Home, Chat, and Missions are equally unavailable offline; only
previously-fetched `/_next/static/*` assets are cache-first. There is no route-level distinction.

**Queued mutations: built, tested, and wired into nothing.** `hooks/use-offline-queue.ts` is a
complete, carefully engineered offline-queue-with-retry hook (localStorage persistence within a
session, exponential backoff, 3 retries, `online`/`offline` event listeners, MAX_QUEUE=50) —
but it has **zero production import sites**. Grep corpus: whole snapshot excluding node_modules;
pattern `useOfflineQueue|use-offline-queue` — the only hits are the hook's own file, its own test
(`tests/hooks/use-offline-queue.test.tsx`), and one `docs/project/CHANGELOG.md` mention. No file
under `app/`, `components/`, or `features/` imports it. Positive control: the same grep style
against `useMissionsData` (a hook known to be consumed) returns its definition plus a real
import site in `app/(mastery)/missions/page.tsx`, confirming the search methodology finds
consumers when they exist. A sibling piece, `<ConnectionStatus>` (referenced only in this hook's
own code comments as something that used to render a floating pill), is also absent from the tree
— corroborating that this was a real feature that got disconnected, not a hook that was never
finished. **Net effect: a chat message sent while offline is not queued or retried by this
mechanism at all** — whatever the AI SDK's own `useChat`/`use-chat-stream.ts` does on a failed
`fetch` (not fully traced this pass) is the only behavior that actually runs.

Journal drafts (1.9, reflect-composer) and the generic `use-draft-autosave` hook are the only real
offline-safety net: they persist in-progress text locally so a dropped connection or closed tab
doesn't lose a half-written entry, but neither of those hooks retries a *submission* — they only
protect the unsent text sitting in a form.

### 1.11 iOS specifics

- **Standalone detection**: `window.matchMedia("(display-mode: standalone)").matches`, used in
  exactly one place — `components/hud/pwa-install-prompt.tsx:34` — to suppress the install banner
  once already installed. No `navigator.standalone` (the older iOS-specific flag) anywhere (grep
  corpus: app, components, lib; 0 hits), and standalone-vs-browser is not used anywhere else to
  branch UI (e.g. no "hide the address-bar-redundant chrome" logic). Verify current platform
  support for `display-mode: standalone` on the iOS Safari versions in use before relying on it as
  the sole signal.
- **Safe areas**: top — `app/(mastery)/layout.tsx:103`,
  `pt-[env(safe-area-inset-top,0px)]` on `<main>`, dated 2026-07-21 per the inline comment
  (matches the LIVE FACTS "fixed 2026-07-21"). Bottom — `var(--bottom-chrome-h)` published by
  `components/layout/bottom-tab-bar.tsx` and consumed as `pb-[var(--bottom-chrome-h)]`
  (layout.tsx:103) plus `env(safe-area-inset-bottom)` baked into that CSS variable (not
  independently re-verified this pass). The session-expiry banner and the PWA install prompt each
  separately add their own `pt-[env(safe-area-inset-top)]` / `bottom-[calc(64px+env(...))]`
  offsets rather than inheriting a shared safe-area wrapper — three independent call sites doing
  the same math (H: duplication risk if the inset formula ever needs to change).
- **100vh vs 100dvh**: only `100vh` is used (`min-height: 100vh` in `app/styles/base.css:13`, plus
  Tailwind's `h-screen`/`min-h-screen` utility — 5 files under `app/`+`components/` use `h-screen`,
  positive control confirming the grep). No `100dvh` anywhere in `app/styles/*.css` (grep corpus:
  those files; pattern `dvh`; 0 hits). H: in a genuinely standalone installed PWA (no collapsing
  browser chrome) `100vh` and `100dvh` are close to equivalent, so the classic mobile-Safari
  "content hidden behind the address bar" bug mostly doesn't apply post-install — but pre-install
  browsing (Safari tab, Android Chrome tab) still gets the un-fixed version of that bug on any
  `h-screen`/`min-h-screen` element.
- **Keyboard avoidance — real, but Chat-only.** Correcting an earlier pass of this section that
  missed `features/`: `features/chat-v2/lib/island-height.ts` +
  `features/chat-v2/components/chat-island.tsx:123-145` implement a genuinely careful
  `visualViewport`-driven resize: a `resize`/`scroll` listener on `window.visualViewport`
  (feature-detected, line 123) recomputes the chat island's pinned height via
  `resolveIslandHeight()` whenever the soft keyboard changes the visual viewport. The function's
  header comment documents a real, previously-shipped bug (the island rendering exactly
  `--bottom-chrome-h` too tall on every load, measured live at "602.4px shell / 53px chrome …
  53px of overlap") and its fix, and it deliberately distinguishes a keyboard-shrunk viewport from
  a pinch-zoomed one via `visualViewport.scale` (`island-height.ts:64-70`) specifically so pinch
  zoom — left enabled on purpose because `app/layout.tsx:69-71` omits `maximumScale` for WCAG
  1.4.4 — never gets misread as "keyboard is up" and collapses the message list. This is Chat-only
  (grep corpus: app, components, lib, hooks, features; pattern `visualViewport`; exactly 3 hits,
  all under `features/chat-v2/`). Journal's composer (`reflect-composer.tsx`) and every other
  compose surface have no equivalent — for those, keyboard occlusion on iOS standalone relies
  entirely on default browser/OS behavior, which is weaker in standalone PWA mode than in a normal
  Safari tab. Unverified without a device; flagged as a plausible gap outside Chat (H), not
  confirmed.
- **Scroll restoration**: not customized anywhere (grep corpus: app, components, lib; pattern
  `scrollRestoration`; 0 hits) — the app relies entirely on the Next.js/browser default
  back/forward scroll behavior rather than any bespoke logic.
- **Back/navigation via SwipeNavigation** (`components/layout/swipe-navigation.tsx`, mounted
  globally at `(mastery)/layout.tsx:70`): horizontal swipe moves between the 4 `BOTTOM_TABS`
  (line 27, external tabs like the nickstire admin link excluded from the swipe loop, line 21-24
  comment); a 20px edge guard (lines 40-44) explicitly avoids fighting iOS Safari's native
  back-swipe gesture, dated "Wave 39" as a real prior incident (corrupted navigation history).
  Pull-to-refresh (`dy > 120`, lines 81-83) calls `router.refresh()`, not `location.reload()` —
  the comment (lines 76-80) documents that the old `location.reload()` behavior was a full
  app-cold-restart in standalone mode that destroyed in-flight chat drafts/streaming, fixed
  2026-05-23. Both touch listeners are `{ passive: true }` (lines 97-98) and gated to mobile via
  `matchMedia("(max-width: 768px)")` + `"ontouchstart" in window` (line 94) — no keyboard/pointer
  equivalent exists for swipe-between-tabs, but the always-visible BottomTabBar itself is the
  keyboard/pointer-accessible equivalent, so WCAG 2.5.1 (pointer gestures need a single-pointer
  alternative) is satisfied by the tab bar, not by this component.

## 2. PERFORMANCE (structural only — all quantities below are code-derived, not measured; see the UNMEASURED list at the end of this report)

### 2.1 'use client' distribution — best effort, direct-directory counts only

Counted `"use client"` files sitting directly inside each top-level `app/(mastery)/<route>/`
directory (page.tsx + any co-located files) — this is **not** a reachable-component-tree count
(a route with 0 local client files still pulls in client components from `components/`/`features/`;
"chat: 0" below means the chat *route directory* has no local client file, not that Chat ships no
client JS — its client tree lives in `features/chat-v2/`). Positive control: total `"use client"`
files across `app`+`components`+`features`+`hooks` = **324**.

| Route dir | files | Route dir | files |
|---|---|---|---|
| system | 16 | journal | 5 |
| intelligence | 2 | missions | 2 |
| brain, content, decisions, links, market, people, photo-improver, pins, settings, stats | 1 each | chat, goals, learn, scoreboard | 0 |

`system/` (16) dwarfs every other route — consistent with it being the operator-facing admin/debug
surface (crons, logs, actions, alerts, ai-cost, camera, health, tools, schema-history, etc., each
with its own client page).

### 2.2 Heavy libraries — which route actually pays for what

- **recharts**: exactly one importer, `components/stats/body-section.tsx` (Stats route only).
- **katex**: not imported as a JS module anywhere in app code — pulled in transitively via the
  `@streamdown/math` plugin (`package.json:126` pins `katex` 0.16.47 directly as a dependency; CSS
  imported globally in `app/globals.css`).
- **mermaid**: same pattern, via `@streamdown/mermaid`; a comment at
  `components/chat/nick-message.tsx:299` says diagrams render "via the lazy chunk" (plugin-level
  code-splitting, not a `next/dynamic` boundary at the message-renderer level).
- **streamdown** (+ `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`):
  all five imported together in exactly one file, `components/chat/nick-message.tsx:25-29` — the
  chat message renderer. This means Chat's bundle carries markdown+math+diagram+code-highlight
  machinery as one unit; there is no `next/dynamic` wrapper around `nick-message.tsx` itself (grep:
  0 hits for `dynamic(` in that file), so whatever lazy-loading exists is internal to those plugins,
  not visible at the import-graph level from this audit.
- **cmdk**: exactly one importer, `components/ui/command.tsx` — the Command Palette's underlying
  primitive.
- **three / @react-three**: exactly one importer, `components/3d/canvas-inner.tsx` — and it is
  **confirmed dead** by the repo's own mount-graph test
  (`tests/repo/ui-mount-graph.test.ts:40-43`): *"3D scene island (audit W-2) · zero importers ·
  next.config.ts:90 still references it · re-mount or delete is an operator call"* for
  `scene-canvas.tsx`, and `canvas-inner.tsx` is "reached only via scene-canvas, which nothing
  imports." `next.config.ts:94-96` carries the same verdict in a comment. This is not the same
  lazy-loaded unit as Stats' `BodySection` (below) — the two are unrelated `next/dynamic` call
  sites that happen to share a route.
- **Server-only libraries in client files — none found.** `googleapis` is used only via a runtime
  `await import("googleapis")` inside `lib/ai/tools/system.ts:1040,1076,1153` (imported by
  `lib/ai/reasoning/reasoning-tools.ts` and `lib/ai/tools.ts`, both server-side AI tool-call
  modules; no `"use client"` file imports either). `pdf-parse` is likewise a runtime
  `await import("pdf-parse")` inside `lib/integrations/document-parser.ts:115`, consumed only by
  `lib/services/document-ingest.ts` (a server service). Grep corpus for the reverse check (a
  client file importing either): whole tree, patterns `googleapis`/`pdf-parse`; only the two lib
  files above and their server-only consumers matched.

### 2.3 next/dynamic — 6 real split points + 1 confirmed-dead one

`app/(mastery)/stats/page.tsx:73-101` dynamically imports **six** sections individually —
`BodySection`, `LearningLoop`, `IdentityArcCard`, `RecurringEnemiesCard`, `GraduatedSkillsCard`,
`CalibrationSection` — genuine per-section code splitting on the heaviest route (Stats carries
recharts + the parked-3D comment). The `components/3d/*` trio (`canvas-inner.tsx`,
`scene-canvas.tsx`, `scene-skeleton.tsx`) also contains `next/dynamic` machinery (`scene-canvas.tsx`
is the file that calls `dynamic()` to load `canvas-inner.tsx`), but per 2.2 nothing imports
`scene-canvas.tsx` itself — the split point exists in code with no route currently reaching it.

### 2.4 react-virtual — one virtualized list, two known un-virtualized long lists

`@tanstack/react-virtual` has exactly **one** consumer in the whole tree:
`hooks/chat/use-lazy-render-messages.ts`, itself consumed by
`features/chat-v2/components/chat-message-list.tsx` — Chat's message history is virtualized.
Grep corpus for the reverse check (whole tree, pattern `@tanstack/react-virtual` or
`useVirtualizer`) confirms no other consumer exists, which means the Brain/Memory list
(`components/brain/memory-tab.tsx` and friends) and the Missions task list/board render every row
into the DOM unconditionally — neither uses react-virtual. Whether that is currently a real
problem depends on row counts this audit did not measure (U) — long-running usage (months of
journal/task history) is the scenario where an un-virtualized list degrades.

### 2.5 TanStack Query global defaults

`components/providers/trpc-provider.tsx:26-45` — one `QueryClient` per provider instance (React
`useState`, not a module singleton — correct SSR-safe pattern). Defaults:
`staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1` for queries;
`retry: 0` for mutations. **`gcTime` is not overridden anywhere in this file or elsewhere in the
client tree** (grep corpus: app, components, features, hooks; pattern `gcTime`; 0 hits) — the app
relies on whatever the installed `@tanstack/react-query` major version defaults to; this audit did
not independently verify that number against the library's current documentation (U).
`refetchOnWindowFocus: false` is a deliberate, well-reasoned choice, documented inline
(`trpc-provider.tsx:30-36`): the app is an iOS PWA the operator foregrounds constantly, and a
focus-triggered refetch of every mounted query would be "pure redundant load on a PWA" given pages
needing live data already poll via `refetchInterval` — a genuinely good call, not an oversight.

### 2.6 Every refetchInterval / setInterval in the client tree, and the derived steady-state rate

Full inventory (grep corpus: app, components, features, hooks, lib; pattern `refetchInterval`;
literal-value occurrences only, comment-only mentions excluded) — 21 files carry a literal
interval:

| Interval | Where (route/scope) |
|---|---|
| 5s | system/actions (busy-poll sub-query), system/camera (ANPR arrivals), system/inbox |
| 10s (conditional) | system/logs, only while `autoRefresh` is on |
| 15s | brain — suggestion-telemetry-panel |
| 30s | system/actions, system/crons, system/schema-history, system/page.tsx (1 of 7 queries), missions — 2 of the 3 (task.list, task.missions), health-governor-strip (Stats, not Missions), cockpit-observability-view, errors-fingerprints (x2), situation-card |
| 45s | missions — task.deck (the 3rd Missions query) |
| 60s | system/ai-cost, system/tools, system/page.tsx (6 of 7 queries), home-console (operator.brief), app-badge (x2, global), nick-suggestions, intelligence-flags-panel, hub-grid (System hub), command-spine-pulse (Settings), chat-capability-indicator (x2), use-observability (x2) |
| 120s | system/health, session-expiry-banner (idle state, imperative not literal refetchInterval) |
| 300s | bottom-pulse-ticker (x2, global via BottomTabBar), contradictions-card, decision-replay-card, persona-drift-card, preferences-card, use-observability (x2) |
| 900s | ghost-nick-strip |

**Home** (`app/(mastery)/page.tsx` -> `HomeConsole`, 2026-09-01 rewrite, deliberately minimal per
its own header comment — "Absent by design: dashboard grid, stat gauges... nested mini-apps"):
- Route-specific: `trpc.operator.brief` — 1 query, 60s (`components/home/home-console.tsx:39-41`).
  No other Home child component (`BriefStateLine`, `BriefLead`, `NickCommandLine`, `JudgmentQueue`,
  `HorizonLine`, `ChangeLine`) carries a `refetchInterval`.
- Global, mounted for every `(mastery)` route including Home: `AppBadge` (2 queries x 60s,
  `(mastery)/layout.tsx:135`), `BottomPulseTicker` inside `BottomTabBar` (2 queries x 300s,
  `bottom-tab-bar.tsx:20,79`), `SessionExpiryBanner` (1 imperative poll, 120s idle / 30s inside the
  10-min pre-expiry warning window, `session-expiry-banner.tsx:36-37`).
- **Derived steady-state (idle, i.e. most of a session): 2/60 + 2/300 + 1/120 + 1/60 ~= 1 + 0.4 +
  0.5 + 1 = "2.9/min global chrome + 1/min brief" -> ~3.9 requests/minute** on an open Home tab.
  Rises to ~5.4/min in the last 10 minutes before session expiry (session-expiry-banner switches
  to 30s).

**Missions** (`app/(mastery)/missions/page.tsx` -> `useMissionsData`,
`app/(mastery)/missions/hooks/use-missions-data.ts:24-45`, itself a 2026-09-01 rewrite whose own
comment documents THREE removed pollers: `system.healthSummary` — "its read performed a
bodyTracking UPSERT on every 30s poll (a write-on-read)", `operator.characterSheet` — fed a number
nothing displayed, and `task.byId(?taskId=)` — fetched and discarded, never read):
- Route-specific: `task.deck` 45s (line 24-28, `staleTime:20_000`, `refetchOnWindowFocus:true` —
  the one query on this page that DOES refetch on focus), `task.list` 30s (line 30-36),
  `task.missions` 30s (line 38-41) — matches the LIVE FACTS "deck 45s plus two 30s lists" exactly.
  A fourth query, `operator.commandCenterState`, has no `refetchInterval` (mount-only,
  `refetchOnWindowFocus:false`) so it does not add to the steady rate.
- Plus the same global chrome as Home (2.9/min).
- **Derived steady-state: (60/45) + (60/30) + (60/30) + 2.9 ~= 1.33 + 2 + 2 + 2.9 ~= 8.2
  requests/minute** on an open Missions tab — roughly double Home's rate, and the highest of the
  two routes named in scope. (`system/page.tsx`, not in scope here, is denser still — 7 of its own
  queries at 30-60s plus the same global chrome — but it's an operator/admin surface, not a daily
  route.)

### 2.7 force-dynamic — the whole (mastery) tree opts out of static rendering, twice

`export const dynamic = "force-dynamic"` is set at **both** the root `app/layout.tsx:39` and
`app/(mastery)/layout.tsx:42` — the mastery-level declaration is redundant given the root already
covers it (Next.js propagates a dynamic layout to its entire subtree), but both are documented as
intentional: `middleware.ts` stamps a per-request CSP nonce that a statically-prerendered page
would ship without, blocking every framework `<script>` under `'strict-dynamic'` (the comment cites
a real incident: this "hit `/`, all /(mastery) pages, and /voice"). **Consequence**: no route under
`(mastery)` can use the Full Route Cache, ISR, or Partial Prerendering — every navigation is a full
server render. This is a deliberate CSP-driven tradeoff, not an oversight, but it is a real,
permanent performance cost (higher TTFB variance, no static shell to serve instantly) traded for
script-injection defense-in-depth.

### 2.8 Request waterfalls / N+1 — one measured example, parallel not sequential

`next.config.ts:34-40` documents that "Three /api/ultron/* routes (signal, pulse, pulse-digest)
run 10+ Prisma queries during prerender and hit the 60s default," which is why
`staticPageGenerationTimeout` was bumped to 300s. (Note: no `app/api/ultron/signal/route.ts`
exists in this snapshot — the closest live candidates are `situation`, `pulse`, and
`pulse-digest`; the comment's route name may be stale.) Read in full: **`pulse/route.ts:74-136`
is parallel, not a waterfall** — the entire batch (2x `domainPulse` calls, a dynamically-imported
habits shim, `bodyTracking.findMany`, a dynamically-imported drift-engine alert count,
`financialSnapshot.findMany`, `personProfile.findMany`, `task.count`) runs inside one
`Promise.all([...])` (line 90), each branch individually `.catch()`-guarded so one failing query
degrades that field to a default instead of failing the whole response, and the *entire* result is
wrapped in the L1/L2 `cached()` helper (2.11) with a 60s TTL (`"ultron_pulse_v1"`, line 76). H: the
"10+ queries" figure is plausible (several branches — the habits shim, the drift-engine call — may
each issue further queries internally, not traced this pass) but the **await structure is fanned
out, not sequential**; the 300s timeout is far more likely explained by Railway-to-Neon connection
latency during prerender (a separate comment at `next.config.ts:34-35` says exactly this: "Railway
build containers can't reach Neon as fast as Vercel's can") than by an N+1 chain in this route.
This audit did not have time to read `pulse-digest/route.ts` or `situation/route.ts` with the same
rigor — their waterfall/parallel shape is unverified (I).

### 2.9 Image handling

**`next/image` (the `<Image>` component) is used nowhere** — grep corpus: app, components,
features; pattern `next/image`; 0 hits. Exactly one file in the whole client tree renders an image
at all: `components/content/publish-tab.tsx` (a raw `<img>`/background-image, for previewing a
social-media post draft). `next.config.ts:65-69` configures `images: { formats: ["avif","webp"],
minimumCacheTTL: 86400 }` — this configuration is **currently inert**, since nothing calls the
component it governs. This is consistent with the app being data/text-dominant rather than
image-heavy (photo-improver and content-draft previews are the only plausible image surfaces), but
it means Next's automatic responsive-size/format negotiation is not in play anywhere it might
matter (e.g., the photo-improver feature, not independently checked this pass for its own image
display path — U).

### 2.10 Fonts

`app/layout.tsx:1-30` — four fonts, all via `next/font` (self-hosted, zero render-blocking
external font requests by construction): `GeistSans`/`GeistMono` (the `geist` npm package),
`Barlow_Condensed` and `Instrument_Serif` via `next/font/google` (weights 500-800 and 400
respectively, both `display: "swap"`). `Instrument_Serif` is opt-in only via a
`.text-editorial`/`.text-display-serif` utility class per the inline comment (line 20-23) — not a
global override, so it doesn't tax every page that doesn't use it.

### 2.11 Caching layers

`lib/utils/cache.ts` — a clean two-tier TTL cache: **L1** an in-memory `Map` (per serverless
instance, survives a warm function ~5-15min), **L2** Redis (shared across instances, via
`redisGet`/`redisSet`/`redisDel`/`redisDelPrefix` from `./redis`, optional — degrades to L1-only
if `REDIS_URL` is unset or Redis errors, "existing callers don't need changes" per the header
comment). Read path: L1 hit -> return; else L2 hit -> hydrate L1, return; else compute -> write L1
synchronously and L2 fire-and-forget (`void redisSet(...)`, deliberately not awaited "we don't
want Redis latency on the critical path," line 65). Lazy L1 eviction once the map exceeds 100
entries (lines 69-73). `invalidate`/`invalidatePrefix` clear both tiers. `pulse/route.ts` (2.8) is
a real consumer (`cached("ultron_pulse_v1", 60, ...)`). A separate **prompt cache** mentioned in
scope was not located this pass under that name (grep corpus: lib; pattern `prompt.?cache`,
case-insensitive; not confirmed — I).

### 2.12 Service-worker cache correctness

Covered fully in section 1.2 — cache-first is scoped to `/_next/static/` + content-hashed
extensions only (correct: those filenames change per build, so a cached entry can never serve
stale content), `/api/*` and non-GET requests bypass the SW entirely, and no authed HTML is ever
written to Cache Storage. No correctness defect found in the fetch handler itself; the only gap is
the update-notification UX gap already described (section 1.2).

### 2.13 Bundle-analyzer config

`next.config.ts:1-6,325-330` — `@next/bundle-analyzer`, gated `enabled: process.env.ANALYZE ===
"true"`, `openAnalyzer: false` ("CI-friendly — write report, don't open browser"), wired via
`pnpm analyze`. This is opt-in/manual; this audit did not find a CI workflow that runs it
automatically on every PR (not exhaustively checked — I), so there is no automatic bundle-size
regression gate, only an on-demand report.

### 2.14 web-vitals instrumentation, and what /api/system/performance actually reads

**No web-vitals library usage anywhere** — grep corpus: app, components, lib; patterns
`web-vitals`, `reportWebVitals`, `useReportWebVitals`; 0 hits. There is no client-side Core Web
Vitals (LCP/INP/CLS) collection of any kind in this codebase; Sentry's `tracesSampleRate: 0` (per
the LIVE FACTS) means Sentry Performance is also off. **`/api/system/performance`
(`app/api/system/performance/route.ts`, 39 lines) does NOT read web-vitals or any client-reported
metric** — it reads the **`api_request_logs`** table (via
`lib/services/system-pages-b.buildRoutePerformance`, shared with the newer
`trpc.system.routePerformance` procedure "so drift is impossible" per the inline comment) and
computes **server-side p50/p95/p99 + error rate per route path** using Postgres
`percentile_cont` — explicitly chosen over a JS percentile because "JavaScript percentile on 10K
rows would be expensive" (line 6). A route is flagged "slow" at p95 > 2000ms. This is
**server-response-time observability, not real-user Core Web Vitals** — there is no signal
anywhere in this codebase for what LCP/INP/CLS actually looks like on the operator's phone. The
route itself is now the documented rollback path behind the tRPC procedure, not necessarily the
one the live `/system` UI calls (not independently confirmed which one `/system/ai-cost` or
similar actually queries — H).

## 3. ACCESSIBILITY (WCAG 2.2 AA, code-level)

### 3.1 Dialog / sheet / popover primitives — three different quality tiers side by side

- **Base UI-backed (`components/ui/dialog.tsx`, wraps `@base-ui/react/dialog`) — the strong
  tier.** `Dialog`/`DialogTrigger`/`DialogPortal`/`DialogClose`/`DialogOverlay`/`DialogContent`/
  `DialogTitle`/`DialogDescription` are thin wrappers over Base UI's primitives (lines 10-154).
  Focus trap, focus restoration, `Escape`-to-close, and `aria-modal`/`aria-labelledby` wiring are
  the primitive library's contract, not reimplemented here — this audit did not re-verify Base
  UI's own internals (out of scope for an application-code review), but found no override or
  bypass of that behavior in this wrapper. `DialogContent` defaults `showCloseButton` to `true`
  with a real `sr-only`-labelled close button (line 82: `<span className="sr-only">Close</span>`).
  `max-h-[90dvh]` (lines 58, 63) — correctly `dvh` not `vh`, with a comment explaining exactly why
  ("iOS Safari URL-bar collapse doesn't clip"). Consumers of this primitive: `CommandDialog`
  (`components/ui/command.tsx:36-65`, used by the ⌘K Command Palette,
  `components/command-palette.tsx:574,678`) wraps it with a visually-hidden
  (`className="sr-only"`) `DialogHeader`/`DialogTitle`/`DialogDescription` (lines 52-54) — so the
  palette gets a real accessible name even though no title is shown on screen. `MegaConfirmHost`
  (mounted at `(mastery)/layout.tsx:129`, the app's replacement for `window.confirm`, per its own
  header comment "accessible focus-trap Dialog") is presumably built the same way (not re-read in
  full this pass).
- **Manual ARIA, no focus trap (`components/layout/more-sheet.tsx`) — the partial tier.** The More
  sheet sets `role="dialog"` `aria-modal="true"` `aria-label="More navigation"`
  (lines 90-92) and implements real `Escape`-to-close (lines 76-80) and a real, labelled backdrop
  `<button aria-label="Close menu">` (line 96). But `sheetRef` (line 58) is declared and attached
  to the sheet's root (line 106) and never used for anything else — no `Tab`/`Shift+Tab` cycling,
  no `inert` on background content, no initial-focus placement when the sheet opens, and no
  focus-trap library in `package.json` (grep: 0 hits for `focus-trap`/`focus-scope`/
  `react-focus-lock`). **This means the sheet announces `aria-modal="true"` to assistive tech — a
  promise that background content is inert — without actually enforcing it**: a keyboard user can
  Tab out of the open sheet into the page behind it, and a screen-reader user's browser may
  suppress access to that background content based on the `aria-modal` flag even though it isn't
  really blocked. This is a real, citable gap, not a hypothetical one.
- **No ARIA at all (`components/hud/keyboard-shortcuts.tsx:126-169`) — the weak tier.** The
  shortcuts cheatsheet (opened by `?`) is a hand-rolled overlay: a backdrop `<div onClick={...}>`
  and an inner panel with `onClick={e => e.stopPropagation()}`. No `role="dialog"`, no
  `aria-modal`, no accessible name for the panel, no focus movement into it on open, no focus
  trap. `Escape` does close it (handled in the same `handleKey` function that opens it,
  lines 77-81) — the one thing it gets right. A screen-reader user pressing `?` gets **no
  indication a dialog appeared at all** until they happen to tab into it.
- **Net**: three different accessibility qualities for "a thing that overlays the screen and
  should trap focus," in the same codebase, with no apparent shared contract between them — a
  standardized-work gap (kaizen lens): the Base UI wrapper exists and is proven correct
  (Command Palette, standard `Dialog` usages) but `MoreSheet` and the shortcuts cheatsheet were
  each hand-built instead of reusing it.

### 3.2 Command Palette keyboard operability

Delegated to `cmdk` (`components/ui/command.tsx`) inside the Base UI `Dialog` (3.1) — a
well-established accessible combobox/listbox pattern (arrow-key navigation, `Enter` to select,
type-ahead filtering are the library's own contract, not re-verified line-by-line this pass).
Opened via `⌘K`/`Ctrl+K` (not read this pass — the trigger wiring lives in
`components/command-palette.tsx`, mounted globally at root `app/layout.tsx:96`, outside
`(mastery)`, so it is available even on `/auth/sign-in`).

### 3.3 Skip link

Present and correctly implemented: `app/(mastery)/layout.tsx:56-61` — `<a href="#main-content"
class="sr-only focus:not-sr-only ...">Skip to main content</a>`, the first focusable element in
the mastery shell, targeting `<main id="main-content">` (line 103). Standard, correct
visually-hidden-until-focused pattern. Not present in the root shell for `/auth/sign-in` (not
checked this pass — that route sits outside `(mastery)`, so it does not inherit this skip link;
whether it needs one depends on how much chrome precedes its content, unverified — I).

### 3.4 Landmarks and one h1 per page

`<nav>` — `components/layout/bottom-tab-bar.tsx:80`, the primary navigation, correctly a `<nav>`
element (not a bare `<div>`). `<main id="main-content">` — one instance, `(mastery)/layout.tsx:103`
wraps every mastery page's content, so there is exactly one `<main>` landmark per page by
construction (a page component cannot accidentally add a second one without also editing the
shared layout). **h1**: the shared `PageHeader` component (`components/layout/ui.tsx:24-38`)
renders a real `<header className="page-header">` landmark containing eyebrow text, a genuine
`<h1 className="page-title">{title}</h1>`, description, and actions — correct structure where it's
used. **14 of the 35 `app/(mastery)/**/page.tsx` files import `PageHeader`** (grep corpus: those
35 files; pattern `PageHeader`; denominator and count both from direct measurement). A second,
apparently-duplicate implementation, `components/layout/page-header.tsx:17`, also renders a real
`<h1>` but with different styling (`text-3xl md:text-4xl` vs the `page-title` utility class) —
not confirmed how many of the remaining 21 pages use this second component versus a bare inline
heading versus nothing. Exactly one page (`app/(mastery)/intelligence/brief/page.tsx`) has its own
inline `<h1>` outside either shared component. No `role="heading"` usage was found anywhere in
`(mastery)` or `components/layout` as an alternative heading pattern (grep: 0 hits) — so pages not
covered by one of the two `PageHeader` components or their own inline `<h1>` most likely have no
top-level heading at all. This audit did not trace all 35 pages individually to close that gap —
flagged as the single largest unresolved item in this section (I).

### 3.5 Live regions — streaming chat, toasts, and mutation feedback are consistently wired

This is a genuine strength, evidenced across many independent surfaces rather than one lucky hit:
- Chat message stream: `features/chat-v2/components/chat-message-list.tsx:578` —
  `<div role="status" aria-live="polite" className="sr-only">`, announcing streaming updates
  without visually duplicating the transcript.
- Voice mode: `components/chat/realtime-voice-overlay.tsx:106` — the same `role="status"
  aria-live="polite"` pattern for the OpenAI Realtime session's status.
- AI suggestion pill: `components/chat/wisdom-pill.tsx:120-124`, `aria-live="polite"`, with an
  inline comment explicitly reasoning about *when* the screen reader should hear it relative to
  the suggestion's own display timing.
- Nick's inline command-line response: `components/home/nick-command-line.tsx` —
  `role="log"` + `aria-label="Nick's response"` (asserted by
  `tests/components/mobile-a11y.test.tsx:208-212`).
- Settings mutation feedback (`tests/components/mobile-a11y.test.tsx:279-304`, "A10"): the test
  file itself documents the correct underlying rule and enforces it as a regression guard —
  conditionally-rendered error/confirm banners use `role="alert"` (assertive, announces on
  insertion — the right choice for content that doesn't exist until the error happens), while the
  "saved" success indicator uses an **always-mounted** `role="status" aria-live="polite"`
  specifically because "polite regions must pre-exist" to be announced when their content changes
  — a real, correctly-reasoned distinction, not a coincidence.
- `error-card.tsx:67` uses `role="alert"` for inline error display.
- Toasts (`sonner`, mounted at root `app/layout.tsx:99-110`): the library manages its own
  live-announcer region by default; this audit did not read `sonner`'s internals and found no
  code here that would override or suppress it.
- Session-expiry banner (1.1/section 1) also uses `role="alert" aria-live="polite"` — redundant
  (role="alert" already implies assertive) but not harmful.

### 3.6 Reduced motion — one universal rule, not scattered per-component checks

`app/styles/effects.css:338-360` is a single, comprehensive `@media (prefers-reduced-motion:
reduce)` block applied to the universal selector `*, *::before, *::after`, collapsing every
`animation-duration`/`animation-iteration-count`/`transition-duration` to `0.01ms` and
`scroll-behavior` to `auto`, plus two explicit final-state pins for keyframes whose natural end
state isn't visually equivalent to "no motion." The comment documents this replaced an earlier,
narrower version scoped to only 2 of 59 keyframes ("57 other keyframes ran unimpeded"), tracked as
"motion+a11y audit Finding M3 (MEDIUM · a11y)." **Because this is a universal selector, it covers
`NeuralBackground`, `AmbientAura`'s `state-aura-*` classes, `BottomPulseTicker`, and every
`page-enter`/`animate-*` utility without any of those components needing their own reduced-motion
check** — `NeuralBackground` additionally has its own explicit JS-level early-return on
`window.matchMedia("(prefers-reduced-motion: reduce)").matches`
(`components/hud/neural-background.tsx:22`, belt-and-suspenders for its canvas
`requestAnimationFrame` loop, which the CSS rule alone cannot stop since it's driven by JS, not
CSS animation). `AmbientAura` itself (`components/hud/ambient-aura.tsx`) has no component-level
check and needs none — its motion lives entirely in the CSS classes the universal rule already
catches. This is a well-designed, DRY solution to a problem many codebases solve inconsistently.

### 3.7 Target sizes — 44px is the actual enforced floor, not the 48px named in the brief

`tests/components/mobile-a11y.test.tsx` (read in full) is the load-bearing evidence here, and it
consistently locks a **44px** floor ("44px Apple HIG"), not 48px: `features/chat-v2/components/
chat-composer.tsx` icon buttons and the Send/Stop button are `h-11 w-11` (44px, Tailwind's
spacing-scale spelling), the composer textarea is `min-h-11`; ultron diagnostics cards use
`min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px]` (mobile grows to 44px, desktop shrinks
back to a dense 28px via the `sm:` breakpoint) in `decision-replay-card.tsx` and
`preferences-card.tsx`, and `persona-drift-card.tsx` uses `min-h-[44px] sm:min-h-[24px]` for a
dense multi-button row (height-only growth, deliberately not width, "adding min-w-[44px] x3/x4
would crowd the excerpt on a 375px screen"). Separately, exactly 5 files use a literal
`min-h-[48px]`/`min-w-[48px]` (`components/brain/discover-tab.tsx`,
`components/home/brain-node-detail-panel.tsx`, `components/home/home-brain-graph.tsx`,
`components/missions/mission-card.tsx`, `components/missions/mission-edit-drawer.tsx`) — so both
44px and 48px floors coexist as competing conventions. **Both exceed WCAG 2.2's 2.5.8 Target Size
(Minimum) AA threshold of 24×24 CSS px** — this is not a compliance risk at either number, just an
unreconciled inconsistency between two "the policy is Npx" conventions.
Separately, a broader (and much less precise) grep for small icon sizing —
`className="...h-6..."` / `w-6` / `h-7` / `w-7` — matches **80** distinct `className` strings
across `app/`+`components/`. **This count cannot be read as 80 tap-target violations**: most of
these are icon glyphs sized `h-6 w-6` (24×24px) sitting inside a padded button whose actual
clickable area is larger — determining which of the 80 sit inside a sub-24px (or sub-44px, to
match the app's own stricter convention) *clickable* area requires rendering the page, which this
audit could not do (U). It is offered as a signal for a follow-up spot-check, not a finding.
`components/hud/pwa-install-prompt.tsx`'s Install/Not-now buttons are `min-h-[44px] min-w-[44px]`
(1.7) — consistent with the 44px convention.

### 3.8 Color-only status indicators — spot-checked, not exhaustive

The one surface the codebase's own `tokens.css` comments flag as explicitly color-coded —
`components/system/hub-grid.tsx`'s `SEVERITY_PALETTE` — pairs every severity value with a text
`label` in the same object (`{ label: "degraded", severity: "warning" }`,
`{ label: "2 killed", severity: "warning" }`, etc., lines 142-205+) — color is never the only
signal there. `SessionExpiryBanner` (1.x) pairs its colored dot with an `AlertTriangle` icon *and*
text. This audit did not systematically sweep every colored badge/dot in the codebase (a
representative sample only) — a full sweep is outside what static reading can efficiently cover
(I).

### 3.9 Contrast — a documented remediation history, plus one unverified gap

`app/styles/tokens.css` shows real, dated evidence of contrast work, not just plausible-looking
hex values:
- `--text-tertiary` was `#666` (documented 3.03–3.55:1 on dark backgrounds, failing AA, "affected
  208 DOM elements per the v525 mobile audit") and is now `#909090` (~5.0:1 on `--bg-elevated`
  `#1A1A1A`, passing AA) — `tokens.css:26-31`.
- `--nour-text-secondary` was aliased to the wrong token (`--text-tertiary`, ~3.28:1, failing) and
  is now aliased to `--text-secondary` (`#A3A3A3` on `#111`, ~6.4:1, passing), "affects all 13
  usages across the 4 consumer files" — `tokens.css:34-40`.
- The severity-tier colors (rose/red/amber/emerald/sky, `tokens.css:254-269`) carry **computed and
  stated** contrast ratios in their own comments (e.g. amber-300 "AA 7.76/7.40/6.82" against
  bg-base/raised/elevated respectively) and are guarded by a dedicated test,
  `__tests__/severity-tier-gamut.test.ts` — every `-300` "text" tier clears AA 4.5:1 by ≥1.4×,
  every `-400` "dot" tier clears the 3:1 non-text threshold by ≥1.7× (stated in the file's own
  closing comment, `tokens.css:272-275`). Gold (`--gold #FDB913`) against the near-black
  backgrounds (`--bg-void #050505` through `--bg-elevated #1A1A1A`) was not independently computed
  this pass but is a bright, high-lightness color (oklch L≈0.83 per the same file's commentary) on
  a very dark ground — H: very unlikely to be a contrast risk, not measured.
- **Unverified**: `--text-tertiary`'s documented 5.0:1 ratio is computed specifically against
  `--bg-elevated` (`#1A1A1A`). The theme also defines `--bg-surface` (`#222222`, the *lightest* of
  the five background layers) — text-tertiary against that lighter surface would have a lower,
  unstated ratio; this audit did not compute it and did not find a comment confirming it still
  passes AA there (I). The shadcn-bridged tokens (`--muted-foreground: oklch(0.45 0 0)`,
  `--secondary-foreground`, `--accent-foreground`) carry no contrast annotation or test the way
  the two token families above do — whether they clear AA is unverified from source alone (U).

### 3.10 Form error association

Thin. `aria-describedby`/`aria-invalid` appear in exactly **7 files** (grep corpus: app,
components; those two patterns): `components/actions/break-promise-modal.tsx`,
`components/operator/mega-confirm-dialog.tsx`, and five UI primitives
(`badge.tsx`, `button.tsx`, `input-group.tsx`, `input.tsx`, `textarea.tsx`) where `aria-invalid`
mostly appears as a Tailwind state-variant selector (`aria-invalid:border-destructive` styling
hook) rather than confirmed evidence that a real validation-error message is wired to the field
via `aria-describedby` at actual usage sites. This audit did not trace each of the ~14 real
consumers of these primitives to confirm error text is actually associated at the call site — the
primitives *support* the pattern; whether every form that needs it *uses* it is unverified (I).
Consistent with this being a low-form-density personal command app rather than a public
form-heavy product, but a real gap if any of its forms do surface field-level validation errors.

### 3.11 Drag alternatives

`onDragStart`/`draggable` HTML5 drag usage exists in `components/missions/{mission-card,
mission-feed, mission-task-row}.tsx`, `components/actions/{loop-row-item,loop-stream}.tsx`, and
`components/brain-dump-modal.tsx` (likely file-drop, not reordering). **A real keyboard/pointer
alternative exists** for the one checked in full: `components/missions/mission-task-row.tsx:596-
597,624-625` has explicit "move up" / "move down" buttons (`aria-label`+`title` on each) alongside
the `draggable` attribute (line 200) — satisfying WCAG 2.5.7 (Dragging Movements). The other five
files were not individually re-checked for the same pattern this pass (H — likely consistent,
given the one checked file follows the convention deliberately, but not confirmed).

### 3.12 Zoom and reflow

`app/layout.tsx:66-74` — `viewport` deliberately **omits `maximumScale`**, with an explicit inline
comment citing WCAG 1.4.4: "capping zoom at 1 disables pinch zoom in standalone iOS PWAs... which
fails WCAG 1.4.4 — and this app leans on 9-11px text." `features/chat-v2/lib/island-height.ts:64-
70` independently reinforces the same decision at the interaction-logic level — the chat island's
keyboard-avoidance resize explicitly backs off when `visualViewport.scale > 1` specifically so
pinch-zoom is never misread as "the keyboard is covering the screen" and forcibly shrunk (1.11).
Fixed widths: not systematically swept this pass; `100vh` (not `100dvh`) is used in
`app/styles/base.css:13` (`body { min-height: 100vh }`) and via Tailwind's `h-screen`/
`min-h-screen` utilities in 5 files (1.11) — low risk once installed standalone, a plausible
reflow risk pre-install in a browser tab (H, unmeasured). `dvh` is used correctly in 8 places where
keyboard/URL-bar collapse actually matters: the Chat page itself
(`app/(mastery)/chat/page.tsx`), `system/proactive-preview/page.tsx`, `reason-tab.tsx`,
`brain-dump-modal.tsx`, `reasoning-trace-modal.tsx`, `bridge-shell.tsx`, `LogLedgerModal.tsx`, and
the shared `dialog.tsx` primitive (3.1) — so the routes most likely to suffer from a stale `100vh`
already use the safer unit.

### 3.13 Keyboard-shortcut conflicts

`components/hud/keyboard-shortcuts.tsx:55-114` (full file read). Global `window` `keydown`
listener; correctly bails when `e.target.tagName` is `INPUT`/`TEXTAREA`/`SELECT`
(line 66) or a modifier key is held (line 67). **Verified, not assumed**: the Chat composer uses a
real `<textarea>` (`features/chat-v2/components/chat-composer.tsx:430`), and
`contentEditable` is not used anywhere in `features/chat-v2`, `components/journal`, or
`components/chat` (grep: 0 hits) — so the single-letter shortcuts (`r` = refresh, `g` = navigation
prefix, `?` = cheatsheet) cannot accidentally fire while composing a chat message or journal
entry through those surfaces; a hypothesis that they might was checked and refuted, not assumed
either way. The shortcut set itself: `⌘K` (Command Palette, owned by a different component),
`?`/`Shift+/` (cheatsheet), `Escape` (close), a `G`-prefix vim-style chord with a 1.5s window for
12 destinations (`h/n/t/j/b/m/y/s/d/c/e/a/q/p` — no letter is double-mapped, checked directly
against `GO_ROUTES`, lines 33-53), and bare `r` (refresh, dispatches a `CustomEvent`, does not
`preventDefault`). No internal conflicts found. The one thing this component does **not** do well
is its own UI: the cheatsheet it opens has no dialog semantics at all (3.1).

### 3.14 What tests/components/mobile-a11y.test.tsx actually covers now

Read in full (363 lines). The file's own header comment ("Five tests...") is **stale** — it has
grown to roughly a dozen `describe` blocks across labeled findings A2/A3/A6/A7(removed)/A8/A9/A10/
A11 from at least two historical audits (2026-05-12, 2026-06-19), most recently pruned 2026-09-01
("audit W-3"). Two testing strategies coexist, and the file's own comments explain exactly why:
- **Rendered-output assertions** (the newer, stronger pattern) — `BottomPulseTicker` is actually
  rendered via `renderToStaticMarkup` (with its data hooks mocked) and the test asserts on the
  produced markup (`role="region"`, `aria-label="System pulse"`, `aria-live="off"`,
  `min-h-[32px] sm:h-5`), plus a **control test** that asserts the component renders nothing when
  both data feeds are empty ("the null branch is real"). The file's own comment explains why this
  replaced a source-text version: *"A source-text assertion cannot tell a correctly-styled live
  component from a correctly-styled dead one: GlobalTopTicker had been unmounted since #158
  (2026-06-16) and its A6 test stayed green for eleven weeks"* — a concrete, named instance of the
  exact silent-instrument failure mode the repo's own engineering policy warns about generally.
- **Source-text regex assertions** (the older, weaker pattern, still the majority of the file) —
  most `describe` blocks (`readSource(...)` + `.toContain(...)`) still just check that a literal
  string (an aria attribute, a Tailwind class) exists somewhere in a component's source, which
  cannot distinguish a reachable component from an orphaned one on its own. The file's mitigation
  is external, not internal: `tests/repo/ui-mount-graph.test.ts` independently tracks which
  components are actually reachable, and every time it reclassifies a subject as unreachable/
  "PARKED," the corresponding assertion here is **deleted**, not left green — the 2026-09-01
  pruning pass alone removed guards for `situation-card`, `hq-status-chips`, `omni-capture.tsx`,
  `contradictions-card`, `next-action-whisperer`, and `active-task-companion` for exactly that
  reason (comments at lines 328-331, 337-339, 347-349, 359-361). This is a real, working
  discipline, but it depends on the mount-graph test staying current — if a component silently
  stops being reachable without `ui-mount-graph.test.ts` noticing, its source-text a11y guard here
  would go stale the same way the original ticker test did.
- **Concrete bugs this file caught and pins as regressions**, beyond aria wiring: a
  garbage/invalid raw-CSS string (`"@media (hover: none) {!important opacity:100}"`) that left a
  touch-only dismiss button permanently invisible on the iOS PWA (no hover/focus path in
  standalone mode) — fixed to a valid Tailwind arbitrary variant
  (`[@media(hover:none)]:opacity-100`, A9 test); and three ultron cards referencing
  `var(--text-muted)`, a custom property **defined nowhere** in the token files — the exact
  "a token that does not exist emits zero CSS silently" failure class named in this audit's brief,
  caught here as a real historical instance and fixed to `--text-tertiary` (A9 test).

## 4. OBSERVABILITY

### 4.1 instrumentation.ts — boot sequence, tracer, and two separate tracing systems

`instrumentation.ts` (191 lines, read in full) `register()` runs once per server-instance boot,
gated to `NEXT_RUNTIME === "nodejs"` (Edge is deliberately excluded — the file documents a real
prior Turbopack/webpack build break from literal dynamic imports leaking into the Edge compile
graph, lines 30-47). In order:
1. **Sentry** — `await import("./sentry.server.config")` (Node) or `./sentry.edge.config` (Edge),
   "both fail closed when no DSN is configured" (line 22).
2. **`assertEnvOrDie()`** (`@/lib/env`) — fails loudly and **aborts boot** if required prod env vars
   (`AUTH_SECRET`/`CRON_SECRET`/`DATABASE_URL`) are missing, skipped only during `next build`
   (`NEXT_PHASE` guard) so CI stays green; deliberately **not** wrapped in try/catch — "the throw
   MUST propagate to abort boot" (lines 48-62). A real fail-closed boot gate, not just a warning.
3. **`lib/observability/tracer`** is imported (module-load side effect only) so the custom tracer
   singleton is hot before `onRequestError` can fire (line 68).
4. Tool-embedding cache warm-up (fire-and-forget, skipped under `E2E_HERMETIC=1`) — a reliability
   measure, not observability per se, included here because it shares the boot sequence.
5. **`initLangfuseTracing()`** (4.3) — wrapped in try/catch, "never let tracing init break server
   boot" (lines 131-136).
6. Inngest deploy-time self-sync (fire-and-forget) — cron-manifest drift fix, not observability.

**`onRequestError`** (lines 161-190) fires on uncaught errors and does two things in parallel: (a)
`captureRequestError` from `@sentry/nextjs`, and (b) `recordTrace()` into the custom tracer with
`status: 500` and **`durationMs: 0 // can't measure here (sentinel)`** — a real, named
data-quality caveat: every trace recorded via this path always shows 0ms duration regardless of
how long the request actually ran before failing. Both calls are individually try/caught so a
Sentry outage can't break the custom tracer and vice versa.

**Two independent tracing systems coexist**, and the file is explicit that this is deliberate, not
accidental duplication: the custom `lib/observability/tracer.ts` ring buffer ("no OTel SDK
dependency" by design, its own header comment) handles per-request HTTP latency; Langfuse
separately registers a real `@opentelemetry/sdk-node` `NodeSDK` with a `LangfuseSpanProcessor`
(4.3) for AI-call gen_ai spans specifically. **What's on when Langfuse keys are absent**: the
custom tracer, Sentry error capture, and the `AgentTrace`/`ApiRequestLog`/`ErrorLog` DB writes
(4.2, 4.4) are all completely independent of Langfuse and keep working; only the Langfuse
OTel export itself no-ops (`initLangfuseTracing()` sets status `"skipped"`, logs
`langfuse_skipped`, and returns before touching the SDK — zero overhead, not even noop spans are
built per `isLangfuseTelemetryEnabled()`'s gate).

### 4.2 The custom tracer (lib/observability/tracer.ts, read in full)

An in-memory ring buffer, `MAX_TRACES = 1000`, module-scoped singleton — **resets on every cold
start** ("acceptable · we sample, not audit," the module's own words; the comment says "Vercel
cold start" though the app now deploys to Railway per `AGENTS.md` — mildly stale terminology, not
a functional bug). Captures `{ at, method, path, status, durationMs, errorClass? }` per request.
`buildReport()` groups by a normalized path (`/api/ai/chat/abc-123` -> `/api/ai/chat/[id]`, long
hex/uuid segments and bare numeric segments both collapsed) and computes: per-route
count/p50/p95/p99/error-rate, top-10 slowest routes (min 3 samples), top-10 most error-prone
routes (min 5 samples, error count > 0), the last 20 error traces, and an **estimated** RPM
(`traces.length / age-of-window-in-minutes` — an estimate that gets noisier the emptier or newer
the ring is, not a true rolling rate). Read via `GET /api/system/observability` (not independently
re-verified this pass) and intended for `/system/observability`.

### 4.3 Langfuse tracing (lib/observability/langfuse.ts, read in full) — a genuinely careful privacy-by-design implementation

- **Gating, layered**: `isLangfuseConfigured()` (both key env vars present) gates whether the SDK
  starts at all; `isLangfuseTelemetryEnabled(privateMode)` (line 79-81) additionally requires the
  processor to have actually **started** (not just "keys present" — the module's own comment names
  this the "braintrust-wrap lesson": a **separate, prior** integration, `wrapWithBraintrust`,
  shipped 2026-05-17 with a live `BRAINTRUST_API_KEY` in prod and **zero callers outside its own
  file, the entire time** — a third documented instance of the exact "built, tested, unwired"
  defect shape this audit independently found twice more in this codebase (section 1.10's
  `useOfflineQueue`, and section 3.1's manual-ARIA-without-a-focus-trap gap) — AND respects a
  `privateMode` flag: "Private-mode turns are never traced: Langfuse spans carry prompt +
  completion content... content never leaves the process without an explicit, named decision"
  (lines 74-77).
- **A real, fixed distributed-state bug**: Next.js compiles `instrumentation.ts` as a separate
  module instance from the app bundle, so a module-level status variable would exist **twice** at
  runtime — the comment documents the exact failure this caused in prod: "the instrumentation copy
  ran init (boot log said `langfuse_skipped`) while the app-bundle copy that healthSummary reads
  stayed `'uninitialized'` — `/system` showed 'not initialized' over a lane that had in fact
  initialized" (lines 41-50). Fixed by moving state onto `globalThis`, which is shared across the
  module's two compiled instances.
- **Secret masking, belt-and-braces even after the above gating**: `maskLangfuseData()` (lines
  183-187) regex-redacts `sk-`/`pk-`-prefixed API keys and `Bearer <token>` strings from every
  exported span payload — "an API key or bearer token that leaks into a prompt, a tool result or a
  model reply never reaches Langfuse."
- **Environment/release tagging**: `resolveLangfuseEnvironment()` prefers
  `LANGFUSE_TRACING_ENVIRONMENT`, then `RAILWAY_ENVIRONMENT_NAME`, then `NODE_ENV`, sanitized to
  Langfuse's accepted charset (collapses to `"default"` rather than dropping spans on a rejected
  value); `resolveLangfuseRelease()` uses `RAILWAY_GIT_COMMIT_SHA` so a regression can be pinned to
  a deploy.
- **Coverage enforcement**: `tests/observability/ai-sdk-telemetry-gate.test.ts` (not read this
  pass, referenced by `langfuse.ts:95`) "enumerates the call sites and fails on a bare one" —
  every `generateText`/`streamText` call must route through `langfuseTelemetry()`.
- **Single-operator design**: `LANGFUSE_DEFAULT_USER_ID = "operator"` (line 116) — every trace
  belongs to the one user unless a caller overrides it, consistent with the rest of the app.
- **otel-export.ts's allowlist privacy contract** (read in full, separate from Langfuse — this is
  the manual NDJSON export lane, WP-20): **two independent layers**, deliberately redundant
  ("because one is a single point of failure," line 15). Layer 1 — `AGENT_TRACE_EXPORT_SELECT`
  (lines 47-59), an explicit Prisma `select` naming exactly `traceId, parentId, source, provider,
  model, label, durationMs, inputChars, outputChars, costCents, toolCalls` — so `errorMessage`
  (`@db.Text`) and `metadata` (`Json`) are **never read out of the database** for export, not just
  filtered afterward. Layer 2 — `enforceAllowlist()` (lines 82-92) is a runtime check against every
  key actually present on a mapped span; it **throws** (`ExportPolicyError`) rather than silently
  dropping an unrecognized key — "a key nobody predicted is a policy question, not a bad row."
  `FORBIDDEN_EXPORT_COLUMNS = ["errorMessage", "metadata"]` names the two columns explicitly.
  `parseSince()` (lines 108-129) also refuses to guess: an unparseable `--since` window throws
  rather than silently defaulting to "export everything" (explicitly guards against `new
  Date("7")` succeeding as a valid decades-old date instead of the obvious "7d" typo).

### 4.4 Request logging — ApiRequestLog

`prisma/schema.prisma:1448-1463` — `id, method, path, statusCode, durationMs, requestId,
userAgent?, error?, createdAt`, indexed on `[path,createdAt]`, `[statusCode,createdAt]`,
`[createdAt]`. **Retention: 30 days**, both documented (`config/retention.ts:34`, "Debugging
window. Volume aggregates live in SystemMetric beyond this.") and actually enforced
(`app/api/cron/data-cleanup/route.ts:31`, `prisma.apiRequestLog.deleteMany({...})`, Sunday 3am UTC
per the retention file's header). No PII fields beyond `userAgent` and whatever a route's own
`error` string happens to contain — not independently audited for what error strings might leak
(I). This is the table `/api/system/performance` reads (2.14) via `buildRoutePerformance`.

### 4.5 The error path — ErrorBoundary -> /api/errors -> ErrorLog -> /system/logs, plus Sentry

Full chain, each link read directly:
- `components/ui/error-boundary.tsx` (110 lines, read in full) — a class component (function
  components still can't be error boundaries in React), wraps a scoped subtree, labels itself via
  a `name` prop so the telemetry payload identifies *which* boundary tripped (e.g.
  `"HQ.SituationCard"`), auto-posts on `componentDidCatch` via `reportClientError`, renders a
  `GlassCard` fallback with a "retry" button that clears the error and re-renders children once —
  "if the underlying error is persistent, it'll trip again (that's by design — loud vs silent)."
  Mounted around every mastery page's content at `(mastery)/layout.tsx:109` (`name="mastery.page"`
  in the actual mount, not `"mastery.root"` as this file's own doc-comment example says — a minor,
  harmless doc/code naming drift). `ClientErrorTelemetry` (mounted at root `app/layout.tsx:94`)
  separately catches `window.onerror` + unhandled promise rejections through the same pipeline —
  not re-read in full this pass, but `error-boundary.tsx:18` and `POST /api/errors`'s own header
  both describe it as the same dedupe + rate-limit path (client-side dedupe + a 10/min cap).
- `POST /api/errors` (`app/api/errors/route.ts`, read in full) — `auth: "owner"`, validates the
  payload has a non-empty `message`, then calls `recordClientError` (`lib/services/client-error.ts`,
  not read in full — shared with the newer `trpc.system.recordClientError` procedure "so drift is
  impossible," this REST route kept mounted as the rollback path, same pattern as
  `/api/system/performance` and `/api/system/chat-health`). "Server adds a belt-and-suspenders
  sanity cap" beyond the client-side rate limit, per the file's header.
- `ErrorLog` (`prisma/schema.prisma:2246-2257`) — `id, level (error|warn|fatal), message, stack?
  (Text), context? (Json), createdAt`, indexed `[level,createdAt]`/`[createdAt]`. **Retention: 30
  days**, same cron as `ApiRequestLog` (`data-cleanup/route.ts:37`, "Recurring-error detection
  window" per `config/retention.ts:35`).
- **`/system/logs?view=errors`** is the named destination in both `error-boundary.tsx:95` and the
  redirect table in `next.config.ts:259` (`/system/errors` -> `/system/logs?view=errors`) — the
  dedicated `/system/errors` page was consolidated into the unified logs view.
- **Sentry, layered on top, not replacing this path**: `instrumentation.ts`'s `onRequestError`
  (4.1) captures server-side uncaught exceptions to Sentry independently of the client
  `ErrorBoundary`/`/api/errors` chain, which remains the path for *rendered* React errors and
  client-side JS errors. `sentry.client.config.ts` (read in full):
  `sendDefaultPii: false`, `tracesSampleRate: 0`, `enabled: Boolean(dsn)` — matching the LIVE
  FACTS exactly. **`tracesSampleRate: 0` means Sentry Performance/APM is fully off** — Sentry here
  is error-capture only, reinforcing 2.14's finding that there is no real-user performance
  telemetry anywhere in this app.

### 4.6 The AgentTrace vocabulary

`prisma/schema.prisma:1770-1810` (`agent_traces` table), read in full. Fields:
`traceId` (shared across one logical operator request — chat turn, cron run, autonomous cycle —
minted once at the top of the chain), `parentId` (nesting; top-level is `null`), **`source`**:
literally `chat | cron | autonomous | tool | journal | brain | other`, `provider` (`venice | ollama
| openai | anthropic`, null for non-AI helper calls), `model`, `label` (free-form step name, e.g.
`"auto-rename"`, `"task-completion-detector"`), `startedAt`/`finishedAt`/`durationMs`,
`inputChars`/`outputChars`, `costCents`, `toolCalls` (default 0), `errorClass`/`errorMessage`
(`@db.Text`, null on success), `metadata` (`Json`, "firstTokenAt, targetId, etc."), `createdAt`.
Indexed on `[traceId,startedAt]`, `[source,createdAt]`, `[provider,createdAt]`,
`[errorClass,createdAt]`, `[createdAt]`. **Retention: 30 days** (`config/retention.ts:51`, "Per-
AI-call trace. 30d hot covers all dashboards"), enforced by the same Sunday cron. This is the
richest single trace record in the app — cost, latency, char counts, and tool-call count per AI
call, groupable into full request chains via `traceId`/`parentId`.

### 4.7 Health checks — mostly correct, one confirmed false-positive envelope

Eight distinct health-adjacent routes exist under `app/api/system/`: `heartbeat`, `health`,
`health-report`, `health-trend`, `provider-health`, `data-source-probes`, `feature-status`,
`chat-health`. Five read in full this pass:

- **heartbeat/route.ts — correct, and deliberately public** (24 lines). Calls
  `checkDbConnection()`; returns **HTTP 503** `{ status: "degraded", db: false }` when the DB
  connection genuinely fails, and only `{ status: "ok", db_latency_ms }` when it genuinely
  succeeds — no default-to-healthy fallback. Explicitly scoped to `{ status, db_latency_ms }` only
  ("no operator-private data") so external uptime monitors (UptimeRobot etc.) can hit it without a
  session.
- **provider-health/route.ts — also correct** (51 lines). On a probe failure it returns HTTP
  **503** with `{ error: "provider-health probe failed", detail }`, not a fabricated healthy
  snapshot. 30s server-side cache (`Cache-Control: private, max-age=30`) matching HUD polling
  cadence.
- **data-source-probes/route.ts — the confirmed instance of the pattern this audit's brief asked
  to find** (127 lines, read in full). The route reads up to 30 days of persisted probe rows from
  `BrainMemory(category="data_source_probe")`, computes an `emptyStreak` and `alerting` boolean
  per probe, and returns:
  ```
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    probeCount: probes.length,
    alertingCount: probes.filter((p) => p.alerting).length,
    probes,
  };
  ```
  (`route.ts:118-124`). **`ok: true` is a hardcoded literal in the success envelope, unconditional
  on `alertingCount`** — a caller (or a human skimming a log) can see `ok: true` on a response that
  is simultaneously reporting `alertingCount: 3`. This is a naming/shape problem, not obviously a
  logic bug on its own (the real alert signal, `alerting`/`alertingCount`, is present and correct
  in the payload) — but it means "does this endpoint say things are fine" cannot be answered by the
  top-level `ok` field the way `heartbeat`'s can. **Compounding it**: the query that reads probe
  history is wrapped `.catch(() => [])` (line 64) — if that Prisma call itself fails (a DB
  connectivity blip while checking data-source health), `rows` becomes `[]`, every probe's `runs`
  stays empty, the `emptyStreak` loop (line 95-98) never executes (nothing to iterate), so
  `emptyStreak` stays `0`, and `alerting = emptyStreak >= spec.emptyDaysAlertThreshold` evaluates
  **false** for every probe. **Net effect: a database error while checking whether the data-source
  probes are healthy is silently reported as "0 probes alerting" plus `ok: true`** — the exact
  "failed probe defaults to healthy" shape, and it is the query about probe health itself that can
  trigger it.
- **health/route.ts (GET /api/system/health) — no default-healthy bug found, but a documented
  past *exposure* bug worth recording here**: a header comment (lines 4-16) describes a "v9.1.23 ·
  CRITICAL fix from Round-2 audit" — the route was previously marked as public on the assumption
  its payload was "coarse health flags," when `getSystemHealthSnapshot()` actually returned
  filesystem paths, recovery-item details, ALE session status, SQLite table counts, and full
  integration/service detail blocks — "an internal system map readable by any unauthenticated HTTP
  client." Now `auth: "owner"`, with a comment steering external monitors to `heartbeat` instead.
- **health-report/route.ts** — thin wrapper over `buildHealthReport()` (`lib/services/
  system-health.ts`, not read this pass); no default-healthy pattern visible at the route level,
  the underlying service was not audited for the same failure mode (I).
- `chat-health/route.ts` and `feature-status/route.ts` similarly delegate to backing services
  (`buildChatHealth`, `FEATURE_REGISTRY`/`summarize`) not read in full this pass (I) —
  `feature-status` is itself an honesty mechanism worth noting on its own terms: its header
  comment says it exists because "an audit caught that ~30% of new endpoints were dormant
  scaffolding" after a ship wave, and the route's job is specifically to surface LIVE vs DORMANT vs
  PARTIAL rather than let a shipped-but-unwired feature look finished.

### 4.8 Alerting channels

- **Push notifications** (full detail in 1.3): context-aware quiet hours, per-tag cooldown, four
  severity levels with distinct vibrate/TTL/urgency, `chatSeed` deep-linking. This is the primary
  operator-facing alert channel.
- **Telegram**: `app/api/telegram/webhook/route.ts` exists and several `lib/` modules reference
  Telegram send paths (`lib/agent-bridge/scopes.ts`, `lib/agent-bridge/tool-policy.ts`,
  `lib/ai/action-vocab.ts`, `lib/ai/agent-actions/camera-actions.ts`) — not traced in full this
  pass; the memory index's own record of a "morning Telegram" digest corroborates it's a real,
  live secondary channel, but this audit did not verify its content or triggers directly (I).
- No email, Slack, or PagerDuty-style paging integration found in this codebase (not exhaustively
  searched — I).

### 4.9 SLOs

One concrete, well-built SLO exists: **daily AI-cost budget** (`lib/services/cost-slo.ts`, read
in part). Default **$5/day (500 cents)**, configurable via `DAILY_AI_BUDGET_CENTS` env or the
Power Panel's `dailyCostCapCents` setting (the panel cap wins when set `>0`; the env/setting
default is "the always-on safety net" otherwise — the file documents this was unified from two
previously-independent, contradictory caps, "operator decision: 'power panel works'"). Computed
over the existing `AiGeneration` table (reusing `trackGeneration`'s existing cost/duration writes
rather than a parallel cost-event table, explicitly to avoid drift), with a **1.2x threshold
multiplier**: an alert trips when the linear-extrapolated 24h forecast exceeds `budget x 1.2`, not
the raw budget itself — a deliberate buffer against normal variance. Defensive throughout: a
malformed budget value (NaN/negative/blank) falls back to the default "rather than crashing the
calling cron," and a Power Panel read failure falls through to the env/setting default rather than
silently disabling the SLO check. Surfaced via `app/api/cron/cost-slo-check` and
`components/ultron/observability/cost-slo-tile.tsx`; tested (`tests/services/cost-slo.test.ts`).
Beyond cost, the closest thing to a latency/availability SLO is the ad-hoc "p95 > 2000ms = slow"
threshold in `/api/system/performance` (2.14) — a display threshold, not shown to be wired to any
alert.

### 4.10 What is measured vs what /system displays

This audit read enough route/schema code to be confident the underlying data exists for: request
latency percentiles and error rates (`ApiRequestLog` + the custom tracer), per-AI-call cost and
duration (`AgentTrace`, `AiGeneration`), push-delivery outcomes (`AuditEvent` rows tagged
`push_sent`/`push_suppressed`/`push_undelivered`, section 1.3), cron success/failure history
(`CronJobLog`, retained 30d with last-success/last-failure kept forever per `retention.ts:43`),
data-source-probe emptiness streaks (`BrainMemory(category="data_source_probe")`), and client
render/JS errors (`ErrorLog`). Whether every one of these actually renders correctly and currently
on the live `/system/*` pages (as opposed to just being computed correctly by its backing route)
was **not verified** — this audit read route handlers and Prisma models, not the rendered `/system`
UI (U, out of scope for a static code read). `lib/db/slow-query-tracker.ts` (found but not read in
full — 4.9's cost-SLO and `next.config.ts`'s "10+ Prisma queries" comment both point at this being
a real, separate slow-query instrumentation layer beyond the route-level percentile tracker) was
not reconciled against `/api/system/performance`'s route-level view — whether they measure the
same thing at different granularity or are two independent, possibly-drifting sources is
unverified (I).

### 4.11 What is explicitly NOT instrumented

Checked directly (grep corpus: `lib`, `app`; each pattern named) and found genuinely absent:
- **Retrieval quality** — no signal anywhere (RAG/brain-memory recall precision, hybrid-search
  relevance) is measured or logged as a named metric (pattern `retrieval.?quality`; 0 hits).
- **Notification regret** — no tracking of whether a push notification was acted on, dismissed
  immediately, or led to no engagement (pattern `notification.?regret`; 0 hits). The push system
  (1.3) knows what it *sent* and whether the *delivery* succeeded/was suppressed, never what the
  operator *did* with it.
- **Recommendation overrides** — no named metric for how often the operator overrides or ignores
  an AI-suggested action (pattern `recommendation.?override`/`overrideRate`; 0 hits) — despite the
  app tracking `AutonomousAction` outcomes and having an `intent-classifier.ts` override mechanism
  (1.9's `nour:...` localStorage key) for a *different*, unrelated kind of override (routing
  classification, not recommendation acceptance).
- **Dedicated tool-latency rollup** — nuanced, not a clean absence: `AgentTrace.durationMs` is
  captured per call including `source: "tool"` rows, so the raw data exists, but no dedicated
  per-tool-name latency dashboard/aggregate (analogous to the route-level p50/p95/p99 the tracer
  builds for HTTP paths) was found for tool calls specifically.
- **Client-side Core Web Vitals** (section 2.14) — no `web-vitals` library, no `reportWebVitals`,
  Sentry `tracesSampleRate: 0`. There is genuinely no signal anywhere in this codebase for
  real-user LCP/INP/CLS.
- **PWA installation funnel** — no tracking found for how many `beforeinstallprompt` events fire,
  are accepted vs dismissed, beyond the session-scoped `sessionStorage` dismissal flag in
  `pwa-install-prompt.tsx` (section 1.11) — that flag suppresses a repeat prompt, it is not
  exported anywhere as a metric.
- **Service-worker lifecycle events** — no analytics on install/activate/update frequency, cache
  hit/miss rates, or how often the offline fallback page is actually served (section 1.2).

---

## UNMEASURED / NOT VERIFIED — consolidated

Everything below required a running app, a browser, a bundler, or reading a file this pass's time
budget did not reach. Grouped by class; each item also appears inline at its point of use.

**U — genuinely unmeasured (would need a build, a browser, or production access):**
- Every performance quantity implied by structural evidence — actual LCP/INP/CLS, actual bundle
  sizes per route (2.1-2.3, 2.9), actual TanStack Query `gcTime` (2.5, library default not
  independently confirmed), actual request latency (the tracer/AgentTrace/ApiRequestLog schemas
  are read, their live numbers are not).
- Row counts behind the react-virtual gap (2.4) — whether Memories/Missions lists are long enough
  to matter in practice.
- Whether the 80 `h-6`/`w-6`/`h-7`/`w-7` className hits (3.7) represent real sub-44px tap targets
  or icons inside larger padded buttons — needs rendering to resolve.
- `--text-tertiary` contrast against `--bg-surface` specifically, and contrast for the
  shadcn-bridged `--muted-foreground`/`--secondary-foreground`/`--accent-foreground` tokens (3.9)
  — no comment or test states these the way the two remediated token families do.
- Whether the live `/system/*` pages actually render everything their backing routes compute
  correctly (4.10) — routes and schemas were read; rendered output was not.
- iOS platform-support claims quoted from source comments (Wake Lock "full support since 18.4,"
  Badge API "iOS 16.4+," the silent-push strike-count behavior, `display-mode: standalone`
  reliability) — carried as direct quotes of what the code asserts, not independently verified
  against current Apple documentation. **Verify current platform support** before relying on any
  of them.

**I — not verified this pass (a specific file or path this audit did not reach, named at point of use):**
- `pulse-digest/route.ts` and `situation/route.ts`'s waterfall/parallel shape (2.8).
- Whether a CI workflow runs the bundle analyzer automatically (2.13).
- `lib/utils/cache.ts`'s prompt-cache sibling, if one exists under a different name (2.11).
- The photo-improver feature's own image-display path (2.9).
- 21 of 35 `(mastery)` pages' heading structure beyond the two `PageHeader` components (3.4) —
  the single largest open item in the accessibility section.
- Whether `aria-invalid`/`aria-describedby`-capable primitives are actually consumed with real
  error text at their ~14 usage sites (3.10).
- 5 of 6 files using HTML5 `draggable` beyond the one (`mission-task-row.tsx`) confirmed to carry
  a keyboard alternative (3.11).
- `ClientErrorTelemetry`'s own dedupe/rate-limit implementation (4.5) — described only via other
  files' comments about it, not opened directly.
- `lib/services/client-error.ts`, `lib/services/system-health.ts`, `lib/services/system-pages.ts`,
  `lib/system/feature-status.ts` — backing services for routes this audit read only the wrapper
  of (4.5, 4.7).
- Telegram's actual message content/trigger conditions (4.8).
- `lib/db/slow-query-tracker.ts` — found, named, not read; its relationship to
  `/api/system/performance`'s route-level percentiles is unresolved (4.10).
- A systematic sweep for color-only status indicators beyond the two spot-checked surfaces (3.8).

**Corrections made mid-audit, left visible rather than silently fixed**: three absence claims in
section 1 (camera/microphone access, `visualViewport` keyboard avoidance, and by implication the
100vh/dvh framing) were initially wrong because the first grep pass omitted `hooks/` and
`features/` from the search scope. Each was caught by re-running the same check with the correct
scope before this report was finalized, and the corrected text says so inline rather than quietly
replacing the wrong claim. Flagged here because a reader skimming only the executive summary
should know this self-correction happened.

