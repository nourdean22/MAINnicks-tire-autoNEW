/**
 * Conversation-turn model tests (ROS-058 close-out).
 *
 * The star witness: the exact mispairing that blocked fine-tuning — two
 * customer texts before one reply must produce ONE training turn, never two
 * pairs sharing a reply.
 */
import { describe, expect, it } from "vitest";
import {
  attributeResponder,
  buildAllTurns,
  buildConversationTurns,
  normalizeBody,
  turnStats,
  type ResponderLookups,
  type TurnSmsRow,
} from "./services/smsCorpusTurns";

const HOUR = 60 * 60 * 1000;
let idSeq = 1;
const at = (min: number) => new Date(Date.UTC(2026, 6, 25, 12, min));
const row = (conversationId: number, direction: "inbound" | "outbound", body: string, minute: number): TurnSmsRow => ({
  id: idSeq++, conversationId, direction, body, createdAt: at(minute),
});

const plainLookups: ResponderLookups = {
  draftBodies: new Map(),
  orchestrationBodies: new Map(),
  looksAutomated: () => false,
};

describe("the mispairing is dead", () => {
  it("two customer texts + one reply = ONE turn carrying both messages", () => {
    const turns = buildConversationTurns(
      [
        row(1, "inbound", "Do you have tires?", 0),
        row(1, "inbound", "Size is 225/50R17.", 2),
        row(1, "outbound", "Yes, bring it by.", 5),
      ],
      2 * HOUR,
      plainLookups,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.inboundBodies).toEqual(["Do you have tires?", "Size is 225/50R17."]);
    expect(turns[0]!.reply?.body).toBe("Yes, bring it by.");
  });

  it("a second exchange after the reply is its own turn", () => {
    const turns = buildConversationTurns(
      [
        row(2, "inbound", "how much for used tires", 0),
        row(2, "outbound", "Most sizes $40-80 installed.", 3),
        row(2, "inbound", "ok can I come today", 10),
        row(2, "outbound", "Yep, first come first served.", 12),
      ],
      2 * HOUR,
      plainLookups,
    );
    expect(turns).toHaveLength(2);
    expect(turns[1]!.inboundBodies).toEqual(["ok can I come today"]);
  });
});

describe("unanswered turns are counted, not silently dropped", () => {
  it("no outbound within the window → an honest unanswered turn", () => {
    const turns = buildConversationTurns(
      [
        row(3, "inbound", "are you open tomorrow?", 0),
        row(3, "outbound", "We're open Mon-Sat 8-6.", 300), // 5h later — outside 2h window
      ],
      2 * HOUR,
      plainLookups,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.responder).toBe("unanswered");
    expect(turns[0]!.reply).toBeNull();
  });

  it("a conversation ending on customer messages closes unanswered", () => {
    const turns = buildConversationTurns([row(4, "inbound", "hello?", 0)], 2 * HOUR, plainLookups);
    expect(turns[0]!.responder).toBe("unanswered");
  });

  it("proactive/campaign outbounds with no open turn are not turns", () => {
    const turns = buildConversationTurns(
      [row(5, "outbound", "Your tires are due for rotation!", 0)],
      2 * HOUR,
      plainLookups,
    );
    expect(turns).toHaveLength(0);
  });
});

describe("responder attribution prefers durable joins over regexes", () => {
  const lookups: ResponderLookups = {
    draftBodies: new Map([
      [normalizeBody("We can check that size for you."), { autoSent: true }],
      [normalizeBody("Come by and we'll look at it."), { autoSent: false }],
    ]),
    orchestrationBodies: new Map([[normalizeBody("Reminder: your visit is tomorrow."), { variantKey: "reminder_v2" }]]),
    looksAutomated: (b) => /reply STOP/i.test(b),
  };

  it("an auto-sent draft body attributes nickgpt_auto", () => {
    expect(attributeResponder("We can check that size for you.", lookups)).toBe("nickgpt_auto");
  });

  it("an operator-sent draft attributes operator_sent_draft (trains as human)", () => {
    expect(attributeResponder("Come by and we'll look at it.", lookups)).toBe("operator_sent_draft");
  });

  it("an orchestration template body attributes automated_template", () => {
    expect(attributeResponder("Reminder: your visit is tomorrow.", lookups)).toBe("automated_template");
  });

  it("the regex list is only a fallback", () => {
    expect(attributeResponder("Special deal — reply STOP to opt out", lookups)).toBe("automated_template");
    expect(attributeResponder("sure, come on by any time", lookups)).toBe("operator");
  });

  it("normalization tolerates whitespace/case drift in the durable match", () => {
    expect(attributeResponder("  we CAN check   that size for you. ", lookups)).toBe("nickgpt_auto");
  });
});

describe("stats and multi-conversation building", () => {
  it("turnStats reports the responder mix and unanswered count", () => {
    const turns = buildAllTurns(
      [
        row(6, "inbound", "hi", 0),
        row(6, "outbound", "hey, what do you need?", 1),
        row(7, "inbound", "anyone there?", 0),
      ],
      2 * HOUR,
      plainLookups,
    );
    const s = turnStats(turns);
    expect(s.turns).toBe(2);
    expect(s.answered).toBe(1);
    expect(s.unanswered).toBe(1);
    expect(s.byResponder.operator).toBe(1);
    expect(s.byResponder.unanswered).toBe(1);
  });
});
