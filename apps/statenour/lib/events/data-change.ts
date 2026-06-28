/**
 * Cross-surface data-change event bus.
 *
 * The site has many surfaces that read the same underlying data:
 *  - /chat creates tasks, sets MIT, logs score via AI tools
 *  - /tasks renders the authoritative Actions view
 *  - /command (HQ) renders the Actions preview + pulse
 *  - MIT Contract persists to localStorage and reads live
 *
 * Before this bus, each page had a 60s polling loop and any write
 * from another surface sat invisible until the next poll. Now any
 * surface that writes fires a CustomEvent, and every reader listens
 * and refreshes instantly.
 *
 * The bus is intentionally pub/sub with a flat topic space — we
 * don't need replay, queuing, or subscriptions-per-entity. Just:
 * "something in this domain changed, pull fresh data."
 *
 * Usage (emit):
 *   import { notifyDataChanged } from "@/lib/events/data-change";
 *   notifyDataChanged("tasks", { source: "chat-tool", detail: "createTask" });
 *
 * Usage (listen):
 *   import { onDataChanged } from "@/lib/events/data-change";
 *   useEffect(() => {
 *     const off = onDataChanged(["tasks", "commitments"], () => load());
 *     return off;
 *   }, [load]);
 */

export type DataDomain =
  | "tasks"
  | "commitments"
  | "missions"
  | "mit"
  | "score"
  | "habits"
  // Apr 27 · Added so PLAN ↔ NOW ↔ TRACK can refresh when goals
  // change (CRUD, progress logged, archived) and when projects
  // spawn tasks. "missions" already covers project basics but
  // "projects" lets surfaces filter on the UX-level concept.
  | "goals"
  | "projects"
  // v10.0.529.86 · Wave 30 · brain domain · added so chat tool
  // pinMemory + memory mutations from anywhere can trigger /brain
  // page refresh without falling back to the broad "any" fanout.
  | "brain"
  // v10.0.529.87 · Wave 31 · journal + settings domains. The /journal
  // page previously subscribed via ["any"] + a string-match guard
  // (detail === "journal-capture" | "nl-brain-dump" | "nl-decision")
  // which silently dropped tool-driven writes (logSituation,
  // journalDecision, reviewDecisionReplay) that never set those
  // detail strings. Targeted "journal" domain closes the gap.
  // "settings" mirrors the pattern for syncDriveMemory → AiSettings
  // Cold Memory card refresh.
  | "journal"
  | "settings"
  // v10.0.529.88 · Wave 32 · knowledge domain · syncKnowledge writes
  // Drive corpus + indexes. /knowledge page subscribes for targeted
  // refresh instead of "any" fanout.
  | "knowledge"
  | "people"
  | "any";

export interface DataChangeDetail {
  domain: DataDomain;
  /** Which surface fired the event. */
  source: string;
  /** Optional human-readable detail for debugging. */
  detail?: string;
  /** Optional id of the affected record. */
  id?: string | number;
}

const EVENT_NAME = "nour:data-changed";

/**
 * Emit a data-change notification. Safe on the server (no-op).
 */
export function notifyDataChanged(
  domain: DataDomain,
  meta: { source: string; detail?: string; id?: string | number } = { source: "unknown" }
): void {
  if (typeof window === "undefined") return;
  const payload: DataChangeDetail = {
    domain,
    source: meta.source,
    detail: meta.detail,
    id: meta.id,
  };
  window.dispatchEvent(new CustomEvent<DataChangeDetail>(EVENT_NAME, { detail: payload }));
}

/**
 * Subscribe to data-change notifications.
 *
 * Accepts an array of domains to watch. Pass ["any"] to receive
 * every event. The callback receives the full detail so the listener
 * can choose what to refetch based on the source.
 *
 * Returns an unsubscribe function.
 */
export function onDataChanged(
  domains: DataDomain[],
  callback: (detail: DataChangeDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const watched = new Set(domains);
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<DataChangeDetail>).detail;
    if (!detail) return;
    if (watched.has("any") || watched.has(detail.domain)) {
      callback(detail);
    }
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}
