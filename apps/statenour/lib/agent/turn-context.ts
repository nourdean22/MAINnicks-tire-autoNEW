/**
 * lib/agent/turn-context.ts — per-turn async context (2026-08-28 · WP3).
 *
 * A tool needs to know WHICH conversation it is running in before it can
 * schedule a follow-up for that thread, and tool signatures do not carry
 * it. This is the identical problem lib/db/actor.ts already solved, and
 * this is deliberately the same solution rather than a second mechanism:
 * "the chat tool calls are 5 layers deep through tool execution, prisma
 * calls, brain engines. Threading it through every signature is a
 * 200-file refactor we don't need." (actor.ts:32-35)
 *
 * PROOF THE MECHANISM REACHES TOOLS HERE, not an assumption: the chat
 * route already wraps its whole handler in `withActor("nick", ...)`
 * (route.ts:66-67) precisely so `currentActor()` is readable from inside
 * tool execution. Same boundary, same guarantee.
 *
 * WHY THE STORE IS MUTABLE. The conversation id is not known at the top
 * of the handler — it is resolved partway in (new conversations are
 * created during the turn). AsyncLocalStorage.run() has to wrap from the
 * start, so the scope opens with an empty record and is populated once
 * the id exists. Readers must therefore tolerate a null conversationId
 * and refuse rather than guess.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TurnContext {
  conversationId: string | null;
  /** This turn contained web/Drive/email content. Blocks self-scheduling. */
  untrustedInput: boolean;
  /** Private turns leave no trace and may not schedule work. */
  privateMode: boolean;
}

const storage = new AsyncLocalStorage<TurnContext>();

/** Open a turn scope. Call once, at the top of the chat handler. */
export function withTurnContext<T>(seed: Partial<TurnContext>, fn: () => T): T {
  return storage.run(
    {
      conversationId: seed.conversationId ?? null,
      untrustedInput: seed.untrustedInput ?? false,
      privateMode: seed.privateMode ?? false,
    },
    fn,
  );
}

/**
 * Fill in what was not known when the scope opened. No-op outside a
 * scope, so a non-chat caller cannot accidentally create one.
 */
export function updateTurnContext(patch: Partial<TurnContext>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (patch.conversationId !== undefined) ctx.conversationId = patch.conversationId;
  if (patch.untrustedInput !== undefined) ctx.untrustedInput = patch.untrustedInput;
  if (patch.privateMode !== undefined) ctx.privateMode = patch.privateMode;
}

/**
 * Read the active turn. Returns null OUTSIDE a chat turn — a caller that
 * needs a conversation must refuse, never fall back to a guess. Guessing
 * a thread id would post an unprompted message into the wrong
 * conversation, which is worse than not posting at all.
 */
export function currentTurn(): TurnContext | null {
  return storage.getStore() ?? null;
}
