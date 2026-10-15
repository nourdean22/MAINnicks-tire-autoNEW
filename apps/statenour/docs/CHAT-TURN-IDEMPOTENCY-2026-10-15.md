# Chat turn idempotency · 2026-10-15

Branch `statenour/chat-turn-idempotency`, based on `statenour/t2-streaming-receipts` (PR #3057, open when this was written). Not live. Every runtime claim below is from tests and code reading.

## The defect

`POST /api/ai/chat` keeps running a turn after the client disconnects (`result.consumeStream()`, `app/api/ai/chat/route.ts`), and nothing tied a second POST for the same user message to the first:

- `persistUserTurn` deduped only the USER row by `clientMessageId` (`persist-user-turn.ts`). It never told the route "this is a duplicate", so the route went on to run the model again.
- A second run executes the same write tools. `createTask` has no tool-level idempotency; only `social.ts` and `guardian.ts` use `withToolIdempotency`.
- The registry (`active-stream.ts`) is keyed by conversation, not by message, so a second run overwrote the first run's record.
- The client could not tell which of these held, so PR #3057 added client-side holds (`replayOutstandingRef`, `acknowledgedTracesRef`, `judgeAfterUnansweredReplay`, `readSavedTurn`) and listed four limits it could not close: a first-send pre-header failure, a record lost on reload or conversation switch, two hidden attempts in a row, and the resume registry.

Two related defects found while reading the writers:

- A hydrated thread names its user message by the DATABASE id (`use-conversations.ts` maps `id = chat_messages.id`, minted id in metadata). `persistUserTurn` looked up `clientMessageId` only, so the first Regenerate of a loaded conversation wrote a second copy of the user message, and the reply parented on the copy.
- `persist-assistant-message.ts:268-295` drops a regenerated reply when an earlier reply has the same parent (the `chat_messages_assistant_reply_uniq` index). Not fixed here; see Residuals.

## The design

Decide at the top of the handler, from the one durable key both attempts share: the user message's id. Three files, one wiring point.

**`lib/services/chat/turn-claim.ts`** - a lease, one `BrainMemory` row per user message (`active_chat_stream` category, key `turn:<id>`), created before any work so the unique key picks exactly one runner. A heartbeat renews it every 30 s (lease 90 s, renewals stop after 6 min). It is deleted when the run ends. Reclaiming a lapsed lease is a compare-and-swap pinned to the row's `updatedAt` and `expiresAt`. A store failure is `unavailable`, which fails open.

**`lib/services/chat/turn-guard.ts`** - the decision. Claim first, then read what is saved (`chat_messages` is the truth; the lease is only a lock):

| State | `submit-message` | `regenerate-message` |
|---|---|---|
| a live lease exists | 409 `turn_in_flight` | 409 `turn_in_flight` |
| no user row yet | run | run |
| user row, no reply | run (the earlier run died) | run |
| reply saved | 409 `turn_answered` | run, unless any reply of the turn may have run an action: 409 `turn_ran` |
| replies unreadable | 503 `turn_unreadable` | 503 `turn_unreadable` |
| user row unreadable | run | 503 `turn_unreadable` (a regenerate is proof an attempt exists) |

"May have run an action" is the client's own Retry rule, now one function both sides call (`lib/ai/chat/message-side-effect.ts`, lifted out of `features/chat-v2/lib/turn-side-effect.ts`). Private Lab and ephemeral turns are never guarded: they persist nothing.

Refusals carry `X-Trace-Id` (the run it collided with) and `X-Conversation-Id` (the thread a first-send replay never learned). The transport reads both headers off any response, so the client learns the run's identity from a refusal. The JSON body is `{ error, reason, code, traceId, conversationId }`; `chatErrorText` renders `error` and `reason` as two sentences.

**`app/api/ai/chat/route.ts`** - `chatPostInner` mints the trace, calls `guardTurn`, then runs `chatTurn` (the former body, same indentation). A replay of a first send re-sends with no thread id; the guard hands back the thread the first attempt created and the turn runs there instead of opening a second one. The streaming path binds the lease to `afterDrain(terminateWhenDrained(...), onFinishPromise)`: the drain, because an error part resolves `onFinishPromise` while tools can still run, and `terminateWhenDrained` resolves only after the errored row has been settled to its final record, so a replay never reads a row that still says "cannot vouch" for a finished turn; `onFinishPromise`, because the persist finishes after the drain (60 s grace, since the SDK swallows an `onFinish` that throws). Every other response goes through `claim.holdWhileBodyOpen`: an error status releases at once, a body that does the work (an image, an alternate lane) keeps the lease until it closes. A throw releases through `claim.finish()`.

**`lib/services/chat/user-turn-identity.ts`** - one lookup, either id. Used by the guard, `persistUserTurn` and `persistAssistantMessage`.

## Why `regenerate-message` is not a client-supplied "attempt key"

The SDK sends `regenerate-message` for a deliberate Regenerate and for every Retry replay alike (`chat.regenerate()` is the only caller). The server cannot tell them apart, and does not need to: a live run refuses both, and once nothing runs, the saved rows decide. A deliberate regenerate of a clean reply starts fresh; a replay of a reply that ran an action is refused whoever sent it, which is the rule the client already enforces on the bubble.

## Alternatives rejected

- **`action_attempts` ledger.** Right primitive (claim-before-act, CAS), wrong audience: `waiting-summary-data.ts` shows `UNKNOWN`, recent `FAILED` and `EXECUTING` over 30 minutes to the owner, so a row per chat turn would raise owner exceptions for ordinary turns.
- **In-process map.** Dies with the process (fine) but not across replicas or a deploy overlap.
- **Trigger alone** (`submit-message` refused, `regenerate-message` always fresh). Leaves the exact defect: the Retry replay is a regenerate.
- **Attach** (answer the second POST with the running turn's bytes, like the GET resume route). Better experience, but it needs the resume tail moved out of the route file, and refusal is enough to make a replay safe. The 409 already carries what an attach needs; see the client follow-up.
- **A new table.** Not needed; no migration.

## Residuals (said plainly)

1. **At-least-once when the reply row is never saved.** A process killed after a tool ran, or a Neon timeout that fails the final persist (and the errored stub with it), leaves no row to judge: the next replay, either trigger, runs again. Closing it takes either tool-level idempotency (`createTask` and the other writers) or a tombstone: on release, if the tool record shows a possible write and no assistant row carries this trace, keep the lease row as `ran-unsaved` and make the guard refuse both triggers on it. The tombstone is itself a write to the same database, so it only helps when the hiccup is shorter than the persist timeout. Follow-up.
2. **Lockouts are bounded, not absent.** A dead process stops renewing and its lease lapses within 90 s. A persist that never reports is given 60 s after the stream drains (`afterDrain`; the SDK swallows an `onFinish` that throws, so `onFinishPromise` can stay unresolved forever). A stream that never drains stops being renewed after 6 minutes (`TURN_MAX_RUN_MS`; deep turns measure 161 s, maxDuration says 300 s) and lapses 90 s later. In every case the operator can send a new message at once. The common mild form: a Regenerate within a minute of a reply, while the post-turn work that `onFinish` awaits is still running, gets "still working".
3. **A response whose body does the work** (an image is generated inside the returned stream; the alternate lanes reason and persist there, and `NICK_VERIFIED_REGEN` is ON in production per `lib/feature-flags.ts`) cannot be tied to the run by the handler. The lease follows the BODY instead (`holdWhileBodyOpen`): held while it is open, released when it closes or errors. If the client leaves first the work goes on, so the lease is not deleted: it stops renewing and lapses within 90 s. A work item that outlives that after the client left is not caught.
   **A lease can lapse under a live run.** Three failed heartbeats in a row (the Neon pool is capped and contention is the usual failure) let it lapse while the run is alive; a replay then starts a second run, and the first is not told. That is the cost of failing open on a store outage.
4. **The regenerated reply is still dropped** by the unique index when an earlier reply has the same parent. The guard lets a deliberate regenerate start a fresh run; its reply streams to the screen and is not saved. Separate task.
5. **The id is client-supplied.** The app has one authenticated user, so this is a bug guard, not a security boundary. A client that sends no id (or a legacy one over 64 characters) is not guarded.
6. **Cost per guarded turn:** one lease insert, a heartbeat update every 30 s while it runs, one delete; two to four indexed reads before the model starts. The first message of a new thread has no conversation id to scope the user-row lookup, so it reads `chat_messages` by `client_message_id` alone, which has no index of its own (the unique index leads with `conversation_id`): a scan, once per new thread. Not worth an index; revisit if `chat_messages` grows past the point where that shows in the logs.

## What the client can delete (follow-up, not in this PR)

The server now answers the questions these holds exist to ask. After a 409 `turn_in_flight` the client should call `resumeStream()` with the returned `traceId` (the reattach path the network-kill branch already uses, `use-chat-stream.ts` near `killedErrorRef`), instead of showing an error.

Deletable once that lands:

- `replayOutstandingRef` (`use-chat-stream.ts:86`) and the `onTraceId` clearing at `:234`.
- `acknowledgedTracesRef` (`:322`) and the hydrated-trace seeding in `replay`.
- `judgeAfterUnansweredReplay`, `latestTurnTraces`, `RETRY_HELD_RESENT_UNKNOWN` (`features/chat-v2/lib/saved-turn.ts`), and the `replayWentUnanswered` branch (`:464`).
- The saved-turn read before Retry: `readSavedTurn` option (`:58`), `SAVED_TURN_READ_TIMEOUT_MS` (`:34`), `checkingSavedTurnRef` (`:328`), `checkSavedTurn`, `replayIfSavedTurnAllows`, the `serverOwnsErroredTurn` branch (`:457`), `judgeSavedTurn`, `savedTurnVerdict`, `RETRY_HELD_*`. The server's `turn_ran` and `turn_in_flight` replace them.

Stays:

- The `turnHasSideEffect` check in `safeRegenerate`: it answers instantly with no round-trip, and it is now the same function the server runs.
- The network-kill reattach (`killedErrorRef`): reattaching is better than being refused.

## Receipts

See the PR body.
