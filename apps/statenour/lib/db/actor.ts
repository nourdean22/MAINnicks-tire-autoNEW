/**
 * Actor resolution helpers · v7.8 · Apr 29.
 *
 * Phase 1 item #3 of the schema audit gives every mutating table a
 * `createdBy` / `updatedBy` field with a small predictable vocabulary:
 *
 *   "user"               — explicit Nour click / type from a UI surface
 *   "nick"               — AI agent action (chat tool calls, autonomous
 *                          engine, content critic auto-fixes)
 *   "cron:<jobName>"     — scheduled job (cron:brain-cycle,
 *                          cron:weekly-review, cron:auto-linker)
 *   "bridge:<system>"    — cross-system sync inbound
 *                          (bridge:nickstire when shop data flows in)
 *   "system"             — internal automation / fallback
 *
 * This module exposes:
 *
 *   · `resolveActor(input)` — given a request / context object, derive
 *     the actor string. Pure function, no side effects.
 *
 *   · `actorFromCron(jobName)` — fast path for cron handlers.
 *   · `actorFromChat()`        — Nick is acting on Nour's behalf.
 *   · `actorFromBridge(name)`  — inbound sync from another system.
 *
 *   · `withActor(actor, fn)` — async-context wrapper (uses Node's
 *     AsyncLocalStorage so deeply-nested writes can read the actor
 *     without threading it through every function call).
 *
 *   · `currentActor()` — read the active actor from async context.
 *     Returns "system" when called outside a `withActor` scope.
 *
 * Why async context: the chat tool calls are 5 layers deep through
 * tool execution, prisma calls, brain engines. Threading `actor`
 * through every signature is a 200-file refactor we don't need.
 * AsyncLocalStorage carries it implicitly within the async boundary.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type Actor =
  | "user"
  | "nick"
  | "system"
  | `cron:${string}`
  | `bridge:${string}`;

const actorStore = new AsyncLocalStorage<Actor>();

/**
 * Resolve an actor from heterogeneous input shapes:
 *   · string  → assumed to be a pre-formatted actor (e.g. "cron:foo")
 *   · Request → "user" if authed (cookie present), else "system"
 *   · {chat:true} → "nick"
 *   · {cron:string} → "cron:<jobName>"
 *   · {bridge:string} → "bridge:<system>"
 */
export function resolveActor(input: unknown): Actor {
  if (typeof input === "string" && isActor(input)) {
    return input;
  }
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (o.chat === true) return "nick";
    if (typeof o.cron === "string" && o.cron.length > 0) {
      return `cron:${o.cron.slice(0, 50)}` as Actor;
    }
    if (typeof o.bridge === "string" && o.bridge.length > 0) {
      return `bridge:${o.bridge.slice(0, 30)}` as Actor;
    }
    if (typeof o.actor === "string" && isActor(o.actor)) return o.actor;
    if (input instanceof Request) {
      // Browser session inferred from cookie presence. We're not
      // verifying the session here — only resolving for audit
      // tagging. Real auth happens in requireSession().
      const cookie = input.headers.get("cookie") || "";
      if (cookie.length > 0) return "user";
    }
  }
  return "system";
}

/** Type guard — does this string look like one of our known actor shapes? */
export function isActor(s: string): s is Actor {
  return (
    s === "user" ||
    s === "nick" ||
    s === "system" ||
    s.startsWith("cron:") ||
    s.startsWith("bridge:")
  );
}

/** Fast-path constructors. */
export function actorFromCron(jobName: string): Actor {
  return `cron:${jobName.slice(0, 50)}` as Actor;
}
export function actorFromChat(): Actor {
  return "nick";
}
export function actorFromBridge(system: string): Actor {
  return `bridge:${system.slice(0, 30)}` as Actor;
}

/**
 * Run an async function with the given actor in scope. Any
 * `currentActor()` calls inside the function (no matter how deeply
 * nested) will return this actor. Restores the prior context on exit.
 *
 * Usage:
 *   await withActor("nick", async () => {
 *     await prisma.task.update({ data: { ..., updatedBy: currentActor() } });
 *   });
 */
export function withActor<T>(actor: Actor, fn: () => T | Promise<T>): T | Promise<T> {
  return actorStore.run(actor, fn);
}

/**
 * Read the active actor. Returns "system" when called outside any
 * `withActor` scope (sane default for cron-less / non-request paths).
 */
export function currentActor(): Actor {
  return actorStore.getStore() ?? "system";
}

/**
 * Convenience: spread these into any prisma `data` object that has
 * createdBy + updatedBy columns. Reads from current async context.
 *
 *   await prisma.task.create({
 *     data: { ...payload, ...auditCreate() }
 *   });
 *
 * Both fields populated on create. For updates use `auditUpdate()`
 * which only sets `updatedBy`.
 */
export function auditCreate(): { createdBy: Actor; updatedBy: Actor } {
  const a = currentActor();
  return { createdBy: a, updatedBy: a };
}

export function auditUpdate(): { updatedBy: Actor } {
  return { updatedBy: currentActor() };
}
