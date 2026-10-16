# Chat turn idempotency · 2026-10-15

Branch `statenour/chat-turn-idempotency` (PR #3060), replayed onto main after #3057 squash-merged. Not live. Every runtime claim below is from tests and code reading; nothing here ran against a real Postgres.

## The defect

`POST /api/ai/chat` keeps running a turn after the client disconnects (`result.consumeStream()` in `app/api/ai/chat/route.ts`), and nothing tied a second POST for the same user message to the first:

- `persistUserTurn` deduped only the USER row by `clientMessageId`. It never told the route "this is a duplicate", so the route went on to run the model again.
- A second run executes the same write tools. `createTask` has no tool-level idempotency; only `social.ts` and `guardian.ts` use `withToolIdempotency`.
- The registry (`active-stream.ts`) is keyed by conversation, not by message, so a second run overwrote the first run's record.
- The client could not tell which of these held, so #3057 added client-side holds (`replayOutstandingRef`, `acknowledgedTracesRef`, `judgeAfterUnansweredReplay`, `readSavedTurn`) and listed four limits it could not close: a first-send pre-header failure, a record lost on reload or conversation switch, two hidden attempts in a row, and the resume registry.

Found while reading the writers:

- A hydrated thread names its user message by the DATABASE id (`hooks/use-conversations.ts` maps `id = chat_messages.id` and puts the minted id in a top-level `clientMessageId` field). `persistUserTurn` looked up `clientMessageId` only, so the first Regenerate of a loaded conversation wrote a second copy of the user message and parented the reply on the copy.
- Every interceptor fast path (`/save`, logged decision, brain dump, `/img`, F5 commands, strict/chill) saved its user row through `ensureConvAndPersistUser` with no `client_message_id`, and returns before `persistUserTurn`. A guard that finds a turn by that id could not see them.

## The design

Decide at the top of the handler, from the one durable key both attempts share: the user message's id.

**`lib/services/chat/turn-claim.ts`** - a lease, one `BrainMemory` row per user message (`active_chat_stream` category, key `turn:<id>`), created before any work so the unique key picks exactly one runner. A heartbeat renews it every 30 s (lease 90 s, renewals stop after 6 min). It is deleted when the run ends. Reclaiming a lapsed lease is a compare-and-swap pinned to the row's `updatedAt` and `expiresAt`. A store failure is `unavailable`, which fails open. Every write after the claim is pinned to the run's own trace, so a displaced owner can neither extend, rename nor delete the new owner's lease.

**`lib/services/chat/turn-guard.ts`** - the decision. Claim first, then read what is saved (`chat_messages` is the truth; the lease is only a lock). Each database step is bounded to 3 s.

| State | `submit-message` | `regenerate-message` |
|---|---|---|
| a live lease exists | 409 `turn_in_flight` | 409 `turn_in_flight` |
| no user row yet | run | run |
| user row, no reply | run (the earlier run died) | run |
| reply saved | 409 `turn_answered` | run, unless any reply of the turn may have run an action: 409 `turn_ran` |
| replies unreadable or unparseable | 503 `turn_unreadable` | 503 `turn_unreadable` |
| user row unreadable | run | 503 `turn_unreadable` (a regenerate is proof an attempt exists) |

"May have run an action" is the client's own Retry rule, now one function both sides call (`lib/ai/chat/message-side-effect.ts`, lifted out of `features/chat-v2/lib/turn-side-effect.ts`). Private Lab turns, and ephemeral turns, are not guarded (see Residuals 5).

The lease key is the message's ORIGINAL minted id. A hydrated thread names it by database id, so when the user row resolves to a different id than the one first used (the first lookup failed), the guard releases that lease and takes the right one. A message an agent posts on its own (`routerReason` `follow-up`, written by `lib/agent/run-follow-up.ts`) is not counted as a reply to the user's message; a parentless "Action receipts" post is, deliberately, because it records actions that ran.

Refusals are 409/503 with `X-Turn-Refusal: <code>` (read by the transport, below), `X-Trace-Id` (the run it collided with, or the newest saved reply's) and `X-Conversation-Id` (taken from the lease, else from the saved user row). The headers are set only when known. The JSON body is `{ error, reason, code, traceId, conversationId }`; `chatErrorText` renders `error` and `reason` as two sentences.

**`app/api/ai/chat/route.ts`** - `chatPostInner` mints the trace, times a `guard` stage, calls `guardTurn`, then runs `chatTurn` (the former body, same indentation). A replay of a first send re-sends with no thread id; the guard hands back the thread the first attempt created and the turn runs there instead of opening a second one. The streaming path binds the lease to `afterDrain(terminateWhenDrained(...), onFinishPromise)`: the drain, because an error part resolves `onFinishPromise` while tools can still run, and `terminateWhenDrained` resolves only after the errored row has been settled, so a replay never reads a row that still says "cannot vouch" for a finished turn; `onFinishPromise`, because the persist finishes after the drain (60 s grace, since the SDK swallows an `onFinish` that throws). Every other response goes through `claim.holdWhileBodyOpen`: an error status releases at once; a body that does the work (an image, an alternate lane) keeps the lease while its reader is asking for data, and lets it lapse once the reader goes quiet for 30 s or leaves. A throw releases through `claim.finish()`.

**`lib/ai/chat/handlers/shared.ts`** - the fast-path user row now carries the minted id, and a message already saved under it is not written twice. The row is what the guard reads, and the lane's own reply row (parentless, `receiptsUnavailable`) already counts as an answer that may have run an action. The alternative was an "answered" marker written by each lane; a marker is a second source of truth that every lane has to remember to write, and the user row already exists.

The older 30 s content window (identical text saved in the last 30 s is not saved again) now applies only to a post with NO id. With an id, the id is the identity: the same text sent twice under two ids is two messages, each gets its own row, and the lane runs for each (the window never stopped the lane, only the second row, which left that id invisible to the guard). A replay of the second one, once it has finished, is refused like any other. The conversation then holds two identical user bubbles, which matches what the operator sent. `interceptors.ts` hands the message with its id to this writer at both call sites; `tests/ai/chat/interceptors-user-turn-id.test.ts` pins that hand-off.

**`lib/services/chat/user-turn-identity.ts`** - one query, either id when scoped to a thread; the minted id only when unscoped (a first-send replay cannot hold a database id), oldest first. Used by the guard, `persistUserTurn`, `persistAssistantMessage` and the fast-path writer.

**Client (small, in this PR)** - `hooks/chat/use-chat-transport.ts` reports a POST answered with `X-Turn-Refusal` to `features/chat-v2/hooks/use-chat-stream.ts` (`onTurnRefused`). The hook clears the outstanding-replay record, because the server ANSWERED even when the refusal names the very trace already held (`onTraceId` only clears on a different one), and puts back the reply that `regenerate()` removed before the POST. Without it, a refused Regenerate left the reply off the screen and Retry held on every tap (`RETRY_HELD_RESENT_UNKNOWN`) until a reload. Retry then replays and the server decides. Every refusal code is treated the same (the payload is unused); the next tap asks the server again.

The restore is deliberately late and narrow. The transport reports the refusal inside the fetch wrapper, before the SDK throws, while the status is still `submitted`; restoring then makes read-aloud treat the old reply as a new streaming one and speak all of it again. So the hook only sets a flag, and an effect restores once the status is `error`. It restores only when the active conversation is the one the replay started in and the screen is that thread with its tail cut (same message ids); `resetTurn` drops the snapshot even while a request is in flight. Opening another conversation mid-replay therefore never has the old thread written over it. Not done: the transport's header adoption still moves `activeConversationId` back to the refused thread's id, as it does for any response that names a thread.

## Why `regenerate-message` is not a client-supplied "attempt key"

The SDK sends `regenerate-message` for a deliberate Regenerate and for every Retry replay alike (`chat.regenerate()` is the only caller). The server cannot tell them apart, and does not need to: a live run refuses both, and once nothing runs, the saved rows decide. A deliberate regenerate of a clean reply starts fresh; a replay of a reply that ran an action is refused whoever sent it, which is the rule the client already enforces on the bubble.

## Alternatives rejected

- **`action_attempts` ledger.** Right primitive (claim-before-act, CAS), wrong audience: `lib/system/owner-panel-data.ts` and `owner-panel.ts` flag `UNKNOWN`, recent `FAILED` and `EXECUTING` over 30 minutes to the owner, and `lib/home/waiting-summary-data.ts` lists every `EXECUTING` row on Home, so a row per chat turn would raise owner exceptions and clutter Home for ordinary turns.
- **In-process map.** Dies with the process (fine) but not across replicas or a deploy overlap.
- **Trigger alone** (`submit-message` refused, `regenerate-message` always fresh). Leaves the exact defect: the Retry replay is a regenerate.
- **Attach** (answer the second POST with the running turn's bytes, like the GET resume route). Better experience, but it needs the resume tail moved out of the route file; refusal is enough to make a replay safe. The refusal already carries what an attach needs; see the client follow-up.
- **A new table.** Not needed; no migration.

## Residuals (said plainly)

1. **At-least-once when the reply row is never saved.** A process killed after a tool ran, or a Neon timeout that fails the final persist (and the errored stub with it), leaves no row to judge: the next replay, either trigger, runs again. Closing it takes either tool-level idempotency (`createTask` and the other writers) or a tombstone: on release, if the tool record shows a possible write and no assistant row carries this trace, keep the lease row as `ran-unsaved` and make the guard refuse both triggers on it. The tombstone is itself a write to the same database, so it only helps when the hiccup is shorter than the persist timeout. Follow-up.
2. **Lockouts are bounded, not absent.** A dead process stops renewing and its lease lapses within 90 s. A response body nobody reads (the client left before the handler returned; Next then neither reads nor cancels it) is noticed at the next heartbeat after 30 s of silence and lapses 90 s after its last renewal, so about 2 minutes. A persist that never reports is given 60 s after the stream drains (`afterDrain`). A stream that never drains stops being renewed after 6 minutes and lapses 90 s later. The 6 minutes is a chosen bound, not a platform limit: the route exports `maxDuration = 120` but that is inert on Railway and the server has no deadline (`docs/CURRENT-TRUTH.md`); the only real one is the client stall abort at 180 s from submit, and the 161 s worst case there is generation time for 10,000 tokens, before the prompt and tool round trips. A run that legitimately outlives the cap loses its lease and a replay then starts a second run. In every case the operator can send a new message at once. The common mild form: a Regenerate within a minute of a reply, while the post-turn work that `onFinish` awaits is still running, gets "still working".
3. **A lease can lapse under a live run.** Two ways. Three failed heartbeats in a row (the Neon pool is capped and contention is the usual failure) let it lapse while the run is alive. And a reader that leaves a body that is still working stops the renewals on purpose (the work cannot be told to stop): the lease lapses within 90 s of its last renewal. The image lane does its paid work inside the body (`generateImageWithFallback`, up to about 90 s per provider with a fallback behind it), so a Retry after the lease lapsed and before the generation finished starts a second paid generation. Typical generations finish well inside the lease. A replay then starts a second run, and the first is not told. That is the cost of failing open on a store outage, and of bounding the lockout.
4. **The regenerated reply is still dropped** by `chat_messages_assistant_reply_uniq` when an earlier reply has the same parent. The guard lets a deliberate regenerate start a fresh run; its reply streams to the screen and is not saved. For a loaded (hydrated) conversation this PR changes the outcome: the first Regenerate used to write a copy of the user row and save its reply under that duplicate bubble; it now resolves to the original row and the reply is dropped like a live thread's. `tests/services/chat/persist-assistant-parent.test.ts` pins it. Separate task.
5. **Ephemeral turns are not guarded.** `ephemeral` means "transcript not kept": tools and memory writes stay on (Home `/task`, `/capture`), so a repeated POST of an ephemeral id can run a write tool twice. The lease could cover it at no cost, but no client re-posts an ephemeral id today (the command line mints a fresh one per submit), so this is a known gap, not a live exposure. Private Lab strips write tools and is deliberately left out.
6. **The id is client-supplied.** The app has one authenticated user, so this is a bug guard, not a security boundary. A client that sends no id (or one over 64 characters) is not guarded.
7. **Cost per guarded turn:** a user-row lookup, a lease insert, a second user-row lookup, a heartbeat update every 30 s while it runs, an update when the thread is known (`setConversation`, every main-path turn), and one delete; each of the first three is bounded to 3 s and the turn runs on if the store stalls. The first message of a new thread has no conversation id to scope the lookup, so both lookups read `chat_messages` by `client_message_id` alone, which has no index of its own (the unique index leads with `conversation_id`): two scans per new thread, on a table the `ChatMessage` schema comment measured at 5,278 rows on 2026-09-17. Not worth an index; revisit if that shows in the `guard` stage of the `chat_pipeline_stages` log line.
8. **A finished fast-path turn is found by time window, not by parent.** The lane's reply row is parentless, so the guard attributes it to the user message whose window (from that message to the next user message) contains it. If a second user message lands while the first lane is still running, the first lane's reply is written after the second message and falls in the second one's window: a replay of the FIRST message then looks unanswered and runs the lane again. The UI replays only the latest turn, so this needs a lost response plus an overlapping send plus a replay of the older message. Closing it means a parent id on the fast-path reply rows (`buildFastStream` and the image handler). Not done.
9. **`NICK_VERIFIED_REGEN` and the other alternate-lane flags** were treated as live. The only source is a note in `lib/feature-flags.ts` ("Prod: ON via Railway env since 2026-07-22"); `docs/CURRENT-TRUTH.md` calls such notes "a code comment, not a fresh Railway read". It is a claim. The body hold covers those lanes either way.

## What the client can still delete (follow-up, not in this PR)

The server answers the questions these holds exist to ask. After a 409 `turn_in_flight` the client should call `resumeStream()` with the returned `traceId` (the reattach path the network-kill branch already uses, near `killedErrorRef` in `use-chat-stream.ts`) instead of showing an error and waiting for a Retry tap. Once that lands these are deletable:

- `replayOutstandingRef` and the `onTraceId` clearing that guards it.
- `acknowledgedTracesRef` and the hydrated-trace seeding in `replay`.
- `judgeAfterUnansweredReplay`, `latestTurnTraces`, `RETRY_HELD_RESENT_UNKNOWN` (`features/chat-v2/lib/saved-turn.ts`), and the `replayWentUnanswered` branch of `safeRegenerate`.
- The saved-turn read before Retry: the `readSavedTurn` option, `SAVED_TURN_READ_TIMEOUT_MS`, `checkingSavedTurnRef`, `checkSavedTurn`, `replayIfSavedTurnAllows`, the `serverOwnsErroredTurn` branch, `judgeSavedTurn`, `savedTurnVerdict`, `RETRY_HELD_*`. The server's `turn_ran` and `turn_in_flight` replace them.

Stays: the `turnHasSideEffect` check in `safeRegenerate` (instant, no round trip, and now the same function the server runs); the network-kill reattach; and `onTurnRefused` with its restore of the removed reply, which the reattach would fold in.

## Receipts

See the PR body.
