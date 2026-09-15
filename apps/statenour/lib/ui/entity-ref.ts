/**
 * EntityRef · the one object identity the UI, the URL, the chat context
 * bridge and the Reality Ledger agree on · 2026-09-15 (UI workbench slice 1).
 *
 * Before this module, entity focus travelled by three channels that never
 * met: `?tab=` (page-tabs), `?focus=<wisdom-key>` (wisdom-tab), and URL
 * hashes (`#bd-`, `#pin-`, `#task-row-`) that the page-context bridge
 * reads for chat. A row, a graph node, a palette hit and a chat receipt
 * each named the same memory a different way.
 *
 * Shape: `{ kind, id }`, wire form `<kind>:<id>`. It is deliberately the
 * Reality Ledger's `objects[].{type,id}` shape (lib/services/reality-ledger.ts)
 * and the graph neighbourhood's `{type,id}` (lib/services/brain-domain.ts),
 * so a UI focus can become a ledger event and a ledger claim can deep-link
 * back without a translation table.
 *
 * The kind registry is CLOSED. `parseEntityRef` returns null for anything
 * outside it, so a URL cannot smuggle a type the UI has no renderer for.
 * Add a kind here when a real read (a tRPC procedure or a page panel)
 * exists for it — not before.
 */

export const ENTITY_KINDS = [
  "task",
  "mission",
  "goal",
  "person",
  "memory",
  "reflection",
  "decision",
  "journal",
  "pin",
  "claim",
  "alert",
  "cron",
  "tool",
  "device",
  "experiment",
  "content",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** Operator-facing noun for each kind · lowercase, the eyebrow style. */
export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  task: "task",
  mission: "mission",
  goal: "goal",
  person: "person",
  memory: "memory",
  reflection: "reflection",
  decision: "decision",
  journal: "journal entry",
  pin: "pin",
  claim: "claim",
  alert: "alert",
  cron: "cron",
  tool: "tool",
  device: "device",
  experiment: "experiment",
  content: "content",
};

/** Reality Ledger `objects[].id` is capped at 200 chars; mirror it. */
const MAX_ID_LENGTH = 200;

const KIND_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/**
 * `"memory:abc"` → `{ kind: "memory", id: "abc" }`. The FIRST colon splits, so
 * ids may themselves contain colons. Unknown kinds, empty ids and non-strings
 * all yield null — callers treat null as "nothing focused", never as an error.
 */
export function parseEntityRef(raw: unknown): EntityRef | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const kind = text.slice(0, colon);
  const id = text.slice(colon + 1).trim();
  if (!isEntityKind(kind)) return null;
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  return { kind, id };
}

export function formatEntityRef(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Stable key for Sets / Maps / `data-entity` attributes. Same as the wire form. */
export const entityKey = formatEntityRef;

export function sameEntity(
  a: EntityRef | null | undefined,
  b: EntityRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The page-context bridge's field names (components/chat/page-context-bridge.tsx
 * `PageContextPayload`). Kinds the bridge has no field for map to `{}` — the
 * bridge still records the route, so Nick is never told less than before.
 */
export type PageContextAnchor = Partial<
  Record<
    | "lastTaskId"
    | "lastMissionId"
    | "lastGoalId"
    | "lastJournalEntryId"
    | "lastDecisionId"
    | "lastPinId"
    | "lastReflectionId",
    string
  >
>;

const ANCHOR_FIELD: Partial<Record<EntityKind, keyof PageContextAnchor>> = {
  task: "lastTaskId",
  mission: "lastMissionId",
  goal: "lastGoalId",
  journal: "lastJournalEntryId",
  decision: "lastDecisionId",
  pin: "lastPinId",
  reflection: "lastReflectionId",
};

export function toPageContextAnchor(ref: EntityRef): PageContextAnchor {
  const field = ANCHOR_FIELD[ref.kind];
  return field ? { [field]: ref.id } : {};
}
