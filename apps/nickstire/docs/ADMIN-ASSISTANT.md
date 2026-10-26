# Admin assistant ("Ask")

Nour, 2026-10-26: "put a ai in the admin of nicks tire, maybe like a pop up on all pages ... help me answer my
questions do whatever, look up whatever". Job `2026-10-26-admin-assistant`.

## What it is

One button on every admin page opens a sheet (bottom sheet on the phone, side panel on the laptop). The sheet
knows the page he is on, answers from the shop's records with a link to each record it used, and drafts the
actions the admin already has. Nothing it drafts runs until he taps the button on the card.

## How it works

| Piece | Where | Rule |
|---|---|---|
| Ask | `nickActions.ask` (mutation, `server/routers/nick/assistant.ts`) | owner and manager only (`nickActions.*` mutation = `settings.manage`) |
| Model | `invokeLLM`, the app's configured provider | no new provider, key or plan |
| Reads | 9 tools (customers, one customer + history, invoices, sales totals, declined work, calls, web leads, Google reviews, tire prices), each one an EXISTING admin procedure run through `appRouter.createCaller(ctx)` | the signed-in admin's own role is checked per procedure, exactly as when the page calls it |
| Sales totals | summed from `invoices.list`, every counter invoice | `invoices.stats` and `nickActions.shopPulse` count only invoices marked "paid", which means nothing on a counter invoice (SHOP-SOUL section 3), so they can read lower; the tool says so in its result |
| Page context | the sheet sends `{ section, title, url params, customer in view }` when he hits send | shown as a chip he can drop; treated as data, never as instructions |
| Citations | the model writes `[[customer:123]]` / `[[invoice:456]]`; the server keeps only ids a tool returned this turn | a reference to a record the tools never read is removed and counted as "not matched" |
| Unknown | a tool that throws or finds no database returns `unknown`, never zero | the prompt says to answer UNKNOWN for that part |
| Actions | `propose_text`, `propose_note`, `open_page` return a card, never a write | the card runs the existing `customers.quickSms` / `customers.updateNotes` only when he taps; the receipt comes from the mutation result |
| Thread | per device and admin user, last 40 messages in localStorage, "New chat" clears it | follows him across pages (Shopify Sidekick), new chat for a new topic (Linear) |

Shop meanings the prompt carries (`.agents/core/USER.md`): a counter invoice is a closed job and its payment
status means nothing; an estimate with no invoice most likely means the customer walked (an inference unless the
counter recorded the no); follow-ups key to invoices, not bookings; first come first served, no held slots.

## Benchmarked against (Perplexity Pro in Chrome, 2026-10-26)

| Mechanism | Source | Adopted as |
|---|---|---|
| Small context envelope, snapshot on send, scope chip | CopilotKit useCopilotReadable https://docs.copilotkit.ai/reference/v1/hooks/useCopilotReadable · assistant-ui model context https://www.assistant-ui.com/docs/copilots/model-context | page envelope + chip |
| Confirm an exact proposal, outcome on the button, receipt from the real result | AI SDK tool approval https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling · AI Elements Confirmation https://elements.ai-sdk.dev/components/confirmation · Intercom HITL https://www.intercom.com/help/en/articles/14468561-human-in-the-loop-approvals-for-fin-procedures | proposal cards that call existing mutations |
| Prefill and confirm in the app's own surface | Shopify Sidekick app extensions https://shopify.dev/changelog/posts/sidekick-app-extensions-available-today | `open_page` card opens the section or customer drawer |
| One thread across navigation, new chat per topic | Shopify Sidekick https://help.shopify.com/en/manual/ai-powered-tools/sidekick/set-up · Linear Agent https://linear.app/docs/linear-agent | thread follows him, New chat button |
| Citations separate from receipts | AI Elements Sources/Tool https://elements.ai-sdk.dev/components/sources · Notion connectors https://www.notion.com/help/notion-ai-connectors | record chips vs action receipts |
| Mobile drawer, desktop panel, controls near the thumb | shadcn Drawer https://ui.shadcn.com/docs/components/radix/drawer | the app's own `ui/drawer` (vaul) + `ui/sheet` |
| Parallel read tools, render tool results directly | Shopify streaming post https://shopify.engineering/sidekicks-improved-streaming | tool calls in one round run in parallel; record chips come from tool output |

Patterns adopted, packages not: assistant-ui, CopilotKit and AI SDK would each add a runtime and dependencies
the app does not have; the mechanisms above are 300 lines on what is already installed.

## Approaches considered

1. **Chosen: a thin tool loop in nickstire over the admin's own procedures.** Cost: one router file, one sheet.
   Kill criteria: (a) median ask over 20 s across the first 20 asks in the LLM ledger, then add streaming or pin a
   faster model; (b) record questions answered with no tool call in more than 3 of 10 checks, then pin a
   tool-capable model; (c) not opened in 14 days, then remove the button.
2. **Rejected for v1: embed the StateNour Nick agent over the bridge.** It already has memory and a claim
   verifier, but it reads nickstire through bridge endpoints, not the admin's role-checked procedures, cannot
   run an admin mutation as the signed-in user, and adds a second hop of latency.
3. **10x, next:** open the sheet on "what needs you on this page" (prefetched from the page's own reads), so the
   first screen is the answer, not a text box.

## Not in v1

Streaming (the app's `invokeLLM` has none; measured against kill criterion a), a server-side thread table (a new
table is a hand-applied production DDL, Nour's call), tire price changes and approvals (next widening, through
their existing procedures).
