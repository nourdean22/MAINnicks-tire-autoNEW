/**
 * Entity actions · "selection creates actions" · pure descriptors ·
 * 2026-09-15 (UI workbench slice 1).
 *
 * One registry, three consumers: the inspector footer, the selection action
 * bar, and the command palette's "Focused object" group. An action is a
 * descriptor, not a callback — the React layer decides how to run each
 * `kind` (navigate / open chat / pin to workset / copy). That keeps the
 * registry testable and keeps EVERY action honest: only actions with a real
 * destination are listed. Mutations (complete, snooze, park, resolve) are
 * deliberately absent until a global dispatch exists; a page that has one
 * passes its own actions to the inspector as `extraActions`.
 */

import { ENTITY_KIND_LABEL, formatEntityRef, type EntityKind, type EntityRef } from "@/lib/ui/entity-ref";
import { INSPECT_PARAM } from "@/lib/ui/inspect-url";

export type EntityActionKind = "navigate" | "chat" | "workset" | "copy-link";

export interface ActionContext {
  /** Operator-facing label for a ref (title, name, content snippet). */
  labelOf?: (ref: EntityRef) => string | undefined;
}

export interface EntityAction {
  id: string;
  label: string;
  kind: EntityActionKind;
  /** Kinds this action applies to; "*" = every kind. */
  kinds: readonly EntityKind[] | "*";
  /** May run on a multi-selection. */
  multi?: boolean;
  /** navigate / chat: the target href. */
  href?: (refs: readonly EntityRef[], ctx: ActionContext) => string | null;
}

function inspectQuery(ref: EntityRef): string {
  return `${INSPECT_PARAM}=${ref.kind}:${encodeURIComponent(ref.id)}`;
}

/**
 * The page that OWNS each kind. Hash anchors match the ids the pages render
 * (`task-<id>` in mission-task-row.tsx, `bd-<id>` in journal, `pin-<id>` in
 * pins); query-addressed kinds open through the inspector on their page.
 */
export function homeRouteFor(ref: EntityRef): string {
  const id = encodeURIComponent(ref.id);
  switch (ref.kind) {
    case "task":
      return `/missions?${inspectQuery(ref)}#task-${id}`;
    case "mission":
      return "/missions";
    case "goal":
      return "/stats";
    case "person":
      return `/people?${inspectQuery(ref)}`;
    case "memory":
      return `/brain?tab=memory&${inspectQuery(ref)}`;
    case "reflection":
      return "/brain?tab=memory";
    case "decision":
      return `/decisions/${id}`;
    case "journal":
      return `/journal#bd-${id}`;
    case "pin":
      return `/pins#pin-${id}`;
    case "claim":
    case "experiment":
      return "/proof";
    case "alert":
      return "/system/alerts";
    case "cron":
      return "/system/crons";
    case "tool":
      return "/system/tools";
    case "device":
      return "/system";
    case "content":
      return "/content?tab=drafts";
    default:
      return "/";
  }
}

function labelFor(ref: EntityRef, ctx: ActionContext): string {
  const label = ctx.labelOf?.(ref);
  return label && label.trim().length > 0 ? label.trim() : `${ENTITY_KIND_LABEL[ref.kind]} ${ref.id}`;
}

/** The prompt handed to /chat?prompt= — names the objects by their wire ids so Nick can resolve them. */
export function askNickPrompt(refs: readonly EntityRef[], ctx: ActionContext = {}): string {
  if (refs.length === 0) return "";
  if (refs.length === 1) {
    const ref = refs[0]!;
    return `Tell me what you know about this ${ENTITY_KIND_LABEL[ref.kind]}: "${labelFor(ref, ctx)}" (${formatEntityRef(ref)}). Why does it matter right now, and what would you do with it?`;
  }
  const list = refs.map((r) => `- ${labelFor(r, ctx)} (${formatEntityRef(r)})`).join("\n");
  return `Compare these ${refs.length} objects and tell me what connects them, what conflicts, and what to do next:\n${list}`;
}

export const ENTITY_ACTIONS: readonly EntityAction[] = [
  {
    id: "open",
    label: "Open on its page",
    kind: "navigate",
    kinds: "*",
    href: (refs) => (refs.length === 1 ? homeRouteFor(refs[0]!) : null),
  },
  {
    id: "ask-nick",
    label: "Ask Nick",
    kind: "chat",
    kinds: "*",
    multi: true,
    href: (refs, ctx) => (refs.length > 0 ? `/chat?prompt=${encodeURIComponent(askNickPrompt(refs, ctx))}` : null),
  },
  {
    id: "workset",
    label: "Add to workset",
    kind: "workset",
    kinds: "*",
    multi: true,
  },
  {
    id: "copy-link",
    label: "Copy link",
    kind: "copy-link",
    kinds: "*",
  },
];

/**
 * Routes that render a kind THEMSELVES — the page is the inspector for it
 * (/people answers `?inspect=person:` with its own dossier panel). Static so
 * the global host can honour it during SSR and the first client render;
 * `useInspectorOwnership` (dynamic, effect-time) still exists for pages that
 * own a kind conditionally. Review 2026-09-15: ownership registered only in
 * an effect let the server render the phone sheet over the dossier on every
 * /people deep link.
 */
export const ROUTE_OWNED_KINDS: Readonly<Record<string, readonly EntityKind[]>> = {
  "/people": ["person"],
};

export function routeOwnsKind(pathname: string | null | undefined, kind: EntityKind): boolean {
  if (!pathname) return false;
  const owned = ROUTE_OWNED_KINDS[pathname];
  return owned ? owned.includes(kind) : false;
}

/** Actions applicable to this selection: kind-filtered, and multi-only when there is more than one. */
export function actionsFor(refs: readonly EntityRef[]): EntityAction[] {
  if (refs.length === 0) return [];
  const kinds = new Set(refs.map((r) => r.kind));
  return ENTITY_ACTIONS.filter((a) => {
    if (refs.length > 1 && !a.multi) return false;
    if (a.kinds === "*") return true;
    return [...kinds].every((k) => (a.kinds as readonly EntityKind[]).includes(k));
  });
}
