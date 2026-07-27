/**
 * Deterministic catalog templates must obey the same prohibitions as planned
 * replies — because at runtime, nothing makes them.
 *
 * THE STRUCTURAL GAP
 * `smsOrchestrator` has two outbound paths:
 *
 *   if (matchedCatalogEvent) { ... reason = `deterministic_auto_reply:...` }   // AUTO-SENDS
 *   else                     { const replyPlan = buildReplyPlan(...) }         // planner
 *
 * `planViolations` — and therefore `GLOBAL_PROHIBITED` (`CLAIM_APPOINTMENT`,
 * `CLAIM_SAFE_TO_DRIVE`) — lives inside the planner. The catalog branch never
 * reaches it. So the guard named "prohibitions that apply to EVERY planned
 * reply" could not fire on the one path that sends WITHOUT a human or a model
 * in the loop.
 *
 * That is the more dangerous half: templates auto-send.
 *
 * WHY A TEST AND NOT A RUNTIME CHECK
 * Catalog templates are static strings. A runtime check would burn work on every
 * inbound message to re-verify text that cannot change between deploys. A
 * build-time assertion is strictly better: same coverage, zero runtime cost, and
 * a bad template fails CI instead of reaching a customer.
 *
 * FOUND BY: a 9-lane cross-channel audit tracing what SMS actually sends for
 * "my front tire has a bulge in the sidewall" — `price_tires`, `risk:
 * "deterministic"`, empty `secondary`, so a template auto-answered a
 * structurally failed tire with the used-tire price and "Pull up".
 */
import { describe, expect, it } from "vitest";
import { REPLY_CONFIGS, TEMPLATE_VARIANTS } from "./services/smsMessageCatalog";
import { GLOBAL_PROHIBITED } from "./services/smsReplyPlanner";

/** Every static string the catalog can send, with its key for failure output. */
function allTemplates(): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  for (const [key, variants] of Object.entries(TEMPLATE_VARIANTS)) {
    variants.forEach((text, i) => {
      if (typeof text === "string" && text.trim()) out.push({ key: `${key}[${i}]`, text });
    });
  }
  for (const [key, cfg] of Object.entries(REPLY_CONFIGS)) {
    for (const [field, v] of Object.entries(cfg as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim().length > 20) out.push({ key: `${key}.${field}`, text: v });
    }
  }
  return out;
}

describe("catalog templates obey the global prohibitions", () => {
  const templates = allTemplates();

  /**
   * 67 strings at the time of writing (60 variants + 7 config fields). The floor
   * is deliberately close to that: an extractor that silently stops finding
   * templates would make every assertion below vacuously green, which is the
   * exact failure mode this file exists to prevent elsewhere.
   */
  it("covers the whole catalog (a broken extractor would pass everything)", () => {
    expect(templates.length).toBeGreaterThanOrEqual(50);
  });

  for (const claim of GLOBAL_PROHIBITED) {
    it(`no template contains a ${claim.label}`, () => {
      const offenders = templates
        .filter((t) => claim.re.test(t.text))
        .map((t) => `${t.key}: ${t.text.slice(0, 110)}`);
      expect(
        offenders,
        `catalog template(s) contain a ${claim.label}, and the catalog path AUTO-SENDS without ever reaching planViolations:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }

  /**
   * Not in GLOBAL_PROHIBITED, but the same class of hazard and the same
   * unreachable-guard problem: an auto-sent template must never state a wait or
   * a completion time. No live capacity feed exists to support one.
   */
  it("no template promises a wait time or a completion time", () => {
    const re = /\b(?:\d{1,3}\s*(?:-|\s)?\s*(?:min|mins|minute|minutes|hour|hours|hrs?)\b|(?:done|ready|finished)\s+(?:today|by\s+\d))/i;
    const offenders = templates.filter((t) => re.test(t.text)).map((t) => `${t.key}: ${t.text.slice(0, 110)}`);
    expect(offenders, `template(s) promise timing:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the prohibition list is non-empty — an empty list would pass everything", () => {
    expect(GLOBAL_PROHIBITED.length).toBeGreaterThan(0);
    // And the regexes actually match their own hazard, so a broken regex cannot
    // make this whole file green by accident.
    expect(GLOBAL_PROHIBITED.some((c) => c.re.test("it's safe to drive"))).toBe(true);
    expect(GLOBAL_PROHIBITED.some((c) => c.re.test("your appointment is confirmed"))).toBe(true);
  });
});
