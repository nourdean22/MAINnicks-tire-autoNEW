/**
 * SMS conversation-turn model (ROS-058 close-out, 2026-07-25).
 *
 * The corpus exporter used to pair EVERY inbound with the next outbound
 * within 2h — so a customer who texted twice before the shop answered
 * produced TWO training pairs sharing ONE reply:
 *   "Do you have tires?"      → "Yes, bring it by."
 *   "Size is 225/50R17."      → "Yes, bring it by."   (mispaired)
 * That teaches a model to answer the size message with the availability
 * reply. The gated report ruled the exporter unusable for fine-tuning
 * until this was fixed.
 *
 * The turn model: consecutive INBOUND messages form ONE customer turn; the
 * turn's reply is the first outbound within the window of the LAST inbound.
 * A turn with no such outbound is honestly `unanswered` (a metric, not a
 * silent drop). Responder attribution prefers DURABLE joins (nickgpt_drafts,
 * sms_orchestrations) over the regex marker list, which remains only a
 * fallback signal.
 *
 * Pure and injectable — the exporter script consumes this; tests own it.
 */

export interface TurnSmsRow {
  id: number;
  conversationId: number;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: Date;
}

export type Responder =
  | "operator"
  | "operator_sent_draft"
  | "nickgpt_auto"
  | "automated_template"
  | "unanswered";

export interface ConversationTurn {
  conversationId: number;
  inboundBodies: string[];
  inboundAt: Date;
  lastInboundAt: Date;
  reply: { body: string; at: Date } | null;
  responder: Responder;
}

export interface ResponderLookups {
  /** normalized draft body → autoSent flag (from nickgpt_drafts). */
  draftBodies: Map<string, { autoSent: boolean }>;
  /** normalized orchestration body → variantKey (from sms_orchestrations). */
  orchestrationBodies: Map<string, { variantKey: string }>;
  /** fallback: template/campaign hallmark detector (the legacy regex list). */
  looksAutomated: (body: string) => boolean;
}

/** Normalization for durable body matching (whitespace/case drift tolerant). */
export function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

export function attributeResponder(body: string, lookups: ResponderLookups): Exclude<Responder, "unanswered"> {
  const norm = normalizeBody(body);
  const draft = lookups.draftBodies.get(norm);
  if (draft) return draft.autoSent ? "nickgpt_auto" : "operator_sent_draft";
  const orch = lookups.orchestrationBodies.get(norm);
  if (orch) {
    if (orch.variantKey.includes("nickgpt")) return "nickgpt_auto";
    if (orch.variantKey !== "none" && orch.variantKey !== "control") return "automated_template";
  }
  if (lookups.looksAutomated(body)) return "automated_template";
  return "operator";
}

/**
 * Build turns for ONE conversation's chronologically ordered rows.
 * Consecutive inbounds accumulate; an outbound closes the open turn when it
 * lands within `windowMs` of the LAST inbound. Outbounds with no open turn
 * (proactive sends, campaigns) are not turns at all.
 */
export function buildConversationTurns(
  rows: TurnSmsRow[],
  windowMs: number,
  lookups: ResponderLookups,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let open: { conversationId: number; bodies: string[]; firstAt: Date; lastAt: Date } | null = null;

  const closeUnanswered = () => {
    if (!open) return;
    turns.push({
      conversationId: open.conversationId,
      inboundBodies: open.bodies,
      inboundAt: open.firstAt,
      lastInboundAt: open.lastAt,
      reply: null,
      responder: "unanswered",
    });
    open = null;
  };

  for (const row of rows) {
    if (row.direction === "inbound") {
      if (open && open.conversationId !== row.conversationId) closeUnanswered();
      if (!open) {
        open = { conversationId: row.conversationId, bodies: [], firstAt: row.createdAt, lastAt: row.createdAt };
      }
      open.bodies.push(row.body);
      open.lastAt = row.createdAt;
      continue;
    }

    // outbound
    if (open && open.conversationId === row.conversationId) {
      const withinWindow = row.createdAt.getTime() - open.lastAt.getTime() <= windowMs;
      if (withinWindow) {
        turns.push({
          conversationId: open.conversationId,
          inboundBodies: open.bodies,
          inboundAt: open.firstAt,
          lastInboundAt: open.lastAt,
          reply: { body: row.body, at: row.createdAt },
          responder: attributeResponder(row.body, lookups),
        });
        open = null;
      } else {
        // The reply came too late to count as answering THIS turn.
        closeUnanswered();
      }
    }
    // An outbound with no open turn is proactive/campaign traffic — not a turn.
  }
  closeUnanswered();
  return turns;
}

/**
 * Build turns across many conversations. Rows must be ordered by
 * (conversationId, createdAt) — the exporter's query already guarantees it.
 */
export function buildAllTurns(rows: TurnSmsRow[], windowMs: number, lookups: ResponderLookups): ConversationTurn[] {
  const byConvo = new Map<number, TurnSmsRow[]>();
  for (const r of rows) {
    if (!byConvo.has(r.conversationId)) byConvo.set(r.conversationId, []);
    byConvo.get(r.conversationId)!.push(r);
  }
  const out: ConversationTurn[] = [];
  for (const convoRows of byConvo.values()) out.push(...buildConversationTurns(convoRows, windowMs, lookups));
  return out;
}

export interface TurnStats {
  turns: number;
  answered: number;
  unanswered: number;
  byResponder: Record<string, number>;
}

export function turnStats(turns: ConversationTurn[]): TurnStats {
  const byResponder: Record<string, number> = {};
  let answered = 0;
  for (const t of turns) {
    byResponder[t.responder] = (byResponder[t.responder] ?? 0) + 1;
    if (t.reply) answered++;
  }
  return { turns: turns.length, answered, unanswered: turns.length - answered, byResponder };
}
