# Statenour Chrome Extension · plan doc

**Status:** DRAFT · awaiting operator approval before any build · 2026-05-23
**Owner decision needed:** scope · auth model · LLM cost ceiling · publish-or-private.

## Why this exists

Statenour-os runs at bdnick.info (Railway · custom domain · `autonicks.com` was the pre-2026-05 Vercel domain · retired) and the operator lives on
iPhone PWA + Mac/Windows browser. The PWA covers mobile · the browser
side is currently "operator opens a tab, clicks /chat, types." A Chrome
extension would let the operator capture browser context (current tab,
selection, screenshot, copied text) directly into the statenour brain
WITHOUT switching tabs. That's the single biggest UX gap between
statenour-os and competitor "second brain" tools (Reflect · Mem · Tana
all have one).

This doc lays out scope so the operator can approve / amend / reject
in one read. Nothing built until then.

## The high-leverage features (rank-ordered)

### F1 · Brain dump from anywhere (highest value)
**Trigger:** Cmd+Shift+B (configurable) anywhere in Chrome.
**Action:** Pop a 4-line composer · types reach `POST /api/brain/dump`
(existing route · already takes free-text → BrainMemory rows). Auto-attach
the current URL + page title as context metadata. Esc cancels. Cmd+Enter
sends. Toast "saved to brain · 1.2s." No tab switch needed.
**Why:** Operator currently has to open /chat or /dump tab, type, switch
back. Friction kills capture rate. Browser hotkey + tiny composer is the
shortest possible path.

### F2 · Selection → ask Nick
**Trigger:** select text on any page · right-click → "Ask Nick about this"
(or keyboard Cmd+Shift+A).
**Action:** Pop a side panel · pre-fills the selection as context · operator
adds 1-line question · streams Nick's reply via existing `/api/ai/chat`
SSE. Reply renders in the panel + auto-saves to `chat_messages` so it
shows up in /chat history.
**Why:** Replaces the "copy → switch to /chat → paste → type question"
sequence. The chat path is off-limits for code changes per the standing
directive, but this is READ-ONLY — extension calls the existing API.

### F3 · Page-aware "what's this about" surface
**Trigger:** click extension icon on any tab.
**Action:** Side panel shows: page title · URL · the operator's existing
notes about this URL (BrainMemory rows where metadata.url matches or content
mentions the domain) · related skills/lenses · "ask Nick" / "save to brain" /
"clip selection" actions.
**Why:** Re-discovery. If the operator browsed a competitor's pricing
page 3 months ago and took notes, this surfaces those notes the moment
they're on that page again. The CoALA episodic lane just got domain_knowledge
opened up in Wave B — this is the consumer surface for it.

### F4 · Smart-clip with auto-categorize
**Trigger:** select text + Cmd+Shift+S (save).
**Action:** Saves the selection as a BrainMemory row · pre-classifies
category via the existing detector (`lib/brain/extract-claims.ts` or
similar) · operator can override the category in a 1-tap chip row.
**Why:** Drops the "open dump tab → paste → tag" sequence to 1 keypress.

### F5 · Voice memo to brain (deferred)
**Trigger:** click mic icon · speak · Cmd+Enter to save.
**Action:** Browser MediaRecorder → POST to existing audio-drop endpoint →
Whisper transcript → BrainMemory row.
**Why:** Operator's existing audio-drop flow is on /chat. Browser-side
capture removes the tab switch. **DEFER** because the audio path has
provider cost + needs a kill-switch.

## Out of scope (intentional)

- **Read browser history / bookmarks.** Privacy boundary · operator-only data.
- **Inject UI into other sites' DOMs.** No content-script DOM-overlay
  features. Side panel + popup ONLY. Avoids breaking sites + avoids
  permission scares.
- **Auto-capture every page visit.** Operator opts-in per page · no
  passive surveillance.
- **AI summaries on every page.** Cost ceiling + privacy. Selection-only.

## Architecture · Manifest V3

```
chrome-extension/
├── manifest.json              MV3 · permissions: activeTab + storage + sidePanel
├── background.ts              Service worker · routes hotkeys + context menu
├── popup.tsx                  4-line composer (F1) · React + Vite
├── sidepanel.tsx              F2 + F3 panel · React + Vite
├── content.ts                 Selection capture (F2 + F4) · minimal · no DOM injection
├── lib/
│   ├── api.ts                 Wraps fetch to statenour-web · adds auth header
│   ├── auth.ts                Stores + refreshes the operator JWT (chrome.storage.local)
│   └── streaming.ts           SSE consumer for /api/ai/chat
└── package.json               Standalone workspace · NOT in statenour-os monorepo
```

**Total surface:** ~6 files · ~600 LOC · Vite build → `dist/` → Chrome
loads as unpacked or .crx.

## Auth model · the hard part

The chat API is operator-gated via NextAuth. The extension can't run
the NextAuth callback flow (it's browser-cookie-based and the extension
runs in a different security context).

**Two viable paths:**

### Path A · Personal API token
Operator generates a long-lived token on `/system/api-tokens` (new page · 
~30 LOC · stores hashed token + revocation). Extension stores the token in
`chrome.storage.local` (not sync · don't sync to other devices' Chrome).
Every API request: `Authorization: Bearer <token>`.

**Pros:** Standard pattern · simple · revocable. **Cons:** New surface to
build · token rotation is manual.

### Path B · OAuth via Chrome's identity API
`chrome.identity.launchWebAuthFlow` redirects to statenour's NextAuth
sign-in · the redirect URL is a chrome-extension://. statenour stores a
device-bound refresh token. Extension exchanges refresh token for access
token every hour.

**Pros:** Real OAuth · multi-device · no manual token rotation. **Cons:**
Adds an OAuth provider to statenour-os (currently NextAuth + Google) ·
chrome-extension:// redirect URI is non-standard · setup is fragile.

**Recommended: Path A.** Simpler · revocable · matches the single-operator
threat model. Build it as a tRPC procedure `system.issueExtensionToken`
(operator-only) + a `/system/api-tokens` surface listing active tokens
with revoke buttons.

## Integration points with existing statenour-os

| Extension feature | Calls | Already exists? |
|---|---|---|
| F1 brain dump | `POST /api/brain/dump` | ✓ exists |
| F2 ask Nick | `POST /api/ai/chat` (SSE) | ✓ exists · off-limits for changes |
| F3 page lookup | NEW `GET /api/brain/by-url?url=...` | needs ~40 LOC · simple BrainMemory query |
| F4 smart-clip | `POST /api/brain/dump` + `POST /api/brain/categorize` | first ✓ · second NEW · ~30 LOC |
| F5 voice memo | existing audio-drop endpoint | ✓ exists · DEFERRED feature |

**New code in statenour-web:** ~100 LOC (the URL-lookup endpoint, the
categorize endpoint, the API-tokens surface) + ~10 LOC of token middleware
in `lib/auth/extension-token.ts`.

**New code in chrome-extension:** ~600 LOC · separate workspace.

## Cost ceiling

Every F2/F3/F4 LLM call rides the existing Venice/Ollama/OpenAI chain
(via the chat API · so the same router decision applies). The
adversarial-critic stays gated by `looksLikeRecommendation`. The
existing per-tool daily quota (ADR-0013) applies — extension calls
count against the operator's chat budget.

**Recommended: extension gets its own quota line item** (e.g.
`ai.extension_chat`) so a buggy hotkey doesn't burn the chat budget.
~20 LOC.

## Open questions for operator

1. **Publish to Chrome Web Store, or unpacked-only?** Web Store = friction
   for install (Google review · 1-7 days) but auto-updates. Unpacked =
   operator drags the dist/ folder into chrome://extensions every release.
   For 1-operator use, unpacked is fine.
2. **Browser scope.** Chrome only, or also Edge (uses same MV3) and Brave
   (same)? MV3 means "Chromium-based browsers." Firefox is a separate
   port (~50 LOC of manifest differences). Recommend: Chromium-only v1.
3. **Multi-device.** If operator uses Chrome on Mac + Windows, each
   install needs its own token. Acceptable trade-off vs OAuth complexity?
4. **Captured-URL retention.** Should clipped URLs auto-expire from
   BrainMemory after N days, or stay forever? (Today the default is
   forever — operator manages via /brain.)

## Recommended next step

If operator approves the scope above:

**Phase 1** (extension scaffold) · ~2h
- Workspace skeleton (Vite + React + MV3)
- F1 brain dump end-to-end
- Path A token issuance + storage
- Manual install instructions in this doc

**Phase 2** (F2 ask Nick) · ~2h
- Side panel UI
- SSE streaming consumer
- Right-click context menu wiring

**Phase 3** (F3 page lookup) · ~1.5h
- New `/api/brain/by-url` endpoint
- Side panel "this URL's notes" section

**Phase 4** (F4 smart-clip + F5 voice deferred) · ~2h
- New `/api/brain/categorize` endpoint
- Cmd+Shift+S handler + auto-classify chips

**Total to operator-usable state:** ~7-8h. Phases 1-2 are the MVP that
delivers 80% of the value. Phases 3-4 polish.

## What this doc does NOT do

- Does not assume Chrome Web Store distribution. Unpacked install is the
  default. If operator wants distribution later it's a separate decision.
- Does not propose any auto-capture / passive-surveillance features.
  Every save is explicit.
- Does not change the chat API path (still off-limits per the standing
  directive). The extension is a NEW consumer of the existing API · not
  a modification.

## Decision

Operator approves / amends / rejects below. Until then, this doc sits
in the repo as documentation. No code moves.
