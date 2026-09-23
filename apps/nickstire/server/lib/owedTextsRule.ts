/**
 * The owed-text rule, pure. Consumer: server/services/owedTexts.ts (getOwedTexts),
 * which feeds the Today queue. The full rationale lives there.
 */
import { isOptOutBody, SMS_OPT_IN_KEYWORDS } from "@shared/smsOptOutKeywords";

/** Let the automated reply answer first. */
const MIN_WAIT_MINUTES = 15;
/** A worklist, not an inbox: the oldest waits are what matter. */
const MAX_ITEMS = 50;

export interface OwedTextRow {
  messageId: number;
  conversationId: number;
  phone: string;
  customerName: string | null;
  direction: "inbound" | "outbound";
  status: string;
  body: string;
  createdAt: Date | string;
  /** Computed in SQL: driver-parsed TiDB timestamps come back shifted on an ET host. */
  ageMinutes: number;
}

export interface OwedText {
  conversationId: number;
  messageId: number;
  phone: string;
  customerName: string | null;
  preview: string;
  lastInboundAt: Date | string;
  waitingMinutes: number;
}

/** The same acknowledgement vocabulary the census uses (scripts/lib/customerCorpus.ts). */
const ACKNOWLEDGEMENT =
  /^\s*(?:(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|great|cool|perfect|got it|sounds good|will do|appreciate it|👍|🙏|❤️)[\s,.!]*)+$/iu;

/** A text the customer does not expect an answer to. */
function needsNoReply(body: string): boolean {
  // "Stop." and "opt-out" are opt-outs too; the shared matcher wants the bare word.
  const bare = String(body ?? "").replace(/[\s.!]+$/, "").replace(/-/g, " ");
  if (isOptOutBody(bare)) return true;
  if ((SMS_OPT_IN_KEYWORDS as readonly string[]).includes(bare.trim().toUpperCase())) return true;
  return ACKNOWLEDGEMENT.test(body ?? "");
}

/** Pure: pick the threads whose customer is waiting on the shop. Oldest wait first. */
export function pickOwedTexts(rows: ReadonlyArray<OwedTextRow>, minWaitMinutes = MIN_WAIT_MINUTES): OwedText[] {
  const byThread = new Map<number, OwedTextRow[]>();
  for (const r of rows) {
    const list = byThread.get(r.conversationId);
    if (list) list.push(r);
    else byThread.set(r.conversationId, [r]);
  }

  const owed: OwedText[] = [];
  for (const thread of Array.from(byThread.values())) {
    // Newest first. ageMinutes is the trustworthy clock; id breaks same-minute ties.
    thread.sort((a, b) => a.ageMinutes - b.ageMinutes || b.messageId - a.messageId);
    const decider = thread.find((m) => !(m.direction === "outbound" && m.status === "failed"));
    if (!decider || decider.direction !== "inbound") continue;
    if (decider.ageMinutes < minWaitMinutes) continue;
    if (needsNoReply(decider.body)) continue;
    if (decider.phone.replace(/\D/g, "").length < 10) continue;
    owed.push({
      conversationId: decider.conversationId,
      messageId: decider.messageId,
      phone: decider.phone,
      customerName: decider.customerName,
      preview: decider.body.replace(/\s+/g, " ").trim().slice(0, 120),
      lastInboundAt: decider.createdAt,
      waitingMinutes: decider.ageMinutes,
    });
  }
  return owed.sort((a, b) => b.waitingMinutes - a.waitingMinutes).slice(0, MAX_ITEMS);
}
