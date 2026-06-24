# Chat v2 Parity Ledger

| Feature | Old Source | New v2 Location | Status | Verified By | Notes |
|---|---|---|---|---|---|
| Send + Stream | `app/(mastery)/chat/page.tsx` | `features/chat-v2/hooks/use-chat-stream.ts` | `ported` | Pending QA | Switched from `append` to `sendMessage({ text })` |
| Message Rendering (Markdown) | `NickMessage` | `features/chat-v2/components/chat-message-list.tsx` | `ported` | Pending QA | Reused battle-tested `NickMessage` component |
| Existing conversation loads | `useChatTransport` | `features/chat-v2/hooks/use-chat-stream.ts` | `ported` | Pending QA | Core transport integration |
| Active `conversationId` | `useChatUiStore` | `features/chat-v2/hooks/use-chat-stream.ts` | `ported` | Pending QA | Synchronized via `bodyRef` |
| Draft Survival | `chat-composer` | `features/chat-v2/components/chat-composer.tsx` | `ported` | Pending QA | Autosaves via `useChatUiStore` |
| Autoscroll follows stream | `use-stick-to-bottom` | `features/chat-v2/components/chat-island.tsx` | `ported` | Pending QA | Implemented via inline hook in ChatIsland |
