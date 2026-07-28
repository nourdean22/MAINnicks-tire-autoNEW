# Chat v2 Parity Ledger

**Reconciled 2026-07-28** (blueprint audit): every row below sat at
"Pending QA" for weeks while chat-v2 was already the shipping surface —
the ledger was doc-lag, not a runtime gap. Verification evidence: chat-v2
is the `(mastery)/chat` production path; the 2026-07-28 waves (#1174–#1176)
built directly on these foundations (control sheet, authority strip,
typed tool cards, Context & Evidence panel) and passed the full verify
gate (typecheck · lint · vitest exit 0 · production build); the deployed
build serves it live on bdnick.info. Fixture-level eyeball coverage:
`/system/chat-states`.

| Feature | Old Source | New v2 Location | Status | Verified By | Notes |
|---|---|---|---|---|---|
| Send + Stream | `app/(mastery)/chat/page.tsx` | `features/chat-v2/hooks/use-chat-stream.ts` | `verified` | production use + verify gate · 2026-07-28 | Switched from `append` to `sendMessage({ text })` |
| Message Rendering (Markdown) | `NickMessage` | `features/chat-v2/components/chat-message-list.tsx` | `verified` | production use + verify gate · 2026-07-28 | Reused battle-tested `NickMessage`; typed tool cards render beside it since #1176 |
| Existing conversation loads | `useChatTransport` | `features/chat-v2/hooks/use-chat-stream.ts` | `verified` | production use + verify gate · 2026-07-28 | Core transport integration |
| Active `conversationId` | `useChatUiStore` | `features/chat-v2/hooks/use-chat-stream.ts` | `verified` | production use + verify gate · 2026-07-28 | Synchronized via `bodyRef` |
| Draft Survival | `chat-composer` | `features/chat-v2/components/chat-composer.tsx` | `verified` | production use + verify gate · 2026-07-28 | Autosaves via `useChatUiStore`; composer gained the labeled control sheet in #1175 |
| Autoscroll follows stream | `use-stick-to-bottom` | `features/chat-v2/components/chat-island.tsx` | `verified` | production use + verify gate · 2026-07-28 | Inline hook in ChatIsland |
