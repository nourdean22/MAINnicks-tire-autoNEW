# @statenour/chrome-extension

> Statenour brain-capture · MV3 · Cmd+Shift+B from any tab.

## What it does (v0.1.0 · F1 only)

Press **Cmd+Shift+B** (Mac) or **Ctrl+Shift+B** (Windows/Linux) on any browser
tab. A small popup opens with a textarea. Type. Press **Cmd+Enter** to save.
Your text + the current tab URL/title sync to your statenour brain via
`POST /api/brain/dump` and show up under `BrainMemory(category=brain_dump)`.

Save time = ~3 seconds. No tab switch.

## Install (v0.1.0 · unpacked only)

```bash
# from monorepo root
pnpm --filter @statenour/chrome-extension build
```

This creates `packages/chrome-extension/dist/`. Then:

1. Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`)
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked** → select `packages/chrome-extension/dist/`
4. Click the extension icon → **Options** → set:
   - API base URL (default: `https://bdnick.info` — the operator-facing custom domain)
   - **Token** (paste from https://bdnick.info/system/api-tokens)

## Generate a token

1. Go to `https://bdnick.info/system/api-tokens` on your statenour instance
2. Click **Issue new**
3. Label it (e.g. `chrome-laptop`, `edge-work-machine`)
4. Copy the raw token (`sn_…`) ONCE · it's sha256-hashed at rest, never retrievable again
5. Paste into the extension options page

## Architecture

- MV3 service worker (`background.js`) · just for future hooks
- Popup (`popup.html` + `popup.js` + `popup.css`) · the entire UX
- Options page (`options.html` + `options.js`) · token storage
- Token stored in `chrome.storage.local` · **NOT** synced to other devices
- All requests use `Authorization: Bearer <token>`

## Scope

- **Permissions:** `activeTab` (to read current tab URL/title) + `storage` (token)
- **Host permissions:** statenour prod + autonicks.com + localhost:3000 only
- **No content scripts** · no DOM injection into other sites
- **No remote code** · all JS is in the package

## Roadmap (deferred from `docs/chrome-extension-plan.md`)

- F2 · selection → ask Nick (right-click + side panel + SSE)
- F3 · page-aware "what's this about" (URL lookup + brain re-discovery)
- F4 · smart-clip with auto-categorize (Cmd+Shift+S)
- F5 · voice memo (DEFERRED · cost + kill-switch needed)

## Privacy

Single-operator extension. Your token gates every request. The extension
NEVER passively captures · every save is explicit (button or Cmd+Enter).
No analytics. No telemetry beyond what your own statenour instance logs.

## License

MIT (same as `@statenour/lenses`).
