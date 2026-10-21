/**
 * wave-141 · preserveLiveTransferDestinations (#harden updateAssistant)
 *
 * The admin "re-push" (vapi.updateAssistant) does a FULL config push, which
 * would reset the transferCall number to the code-default shop landline —
 * wiping the manager cell the operator sets via the VAPI dashboard. This
 * helper carries the live destination into the freshly-built config so a
 * re-push updates only the prompt + tool list, never the number.
 *
 * Regression this guards: a future edit that drops the preserve-merge would
 * silently start clobbering the operator's transfer number on every resync.
 */

import { describe, expect, it } from "vitest";
import { buildAssistantConfig, preserveLiveTransferDestinations } from "./services/vapi";

type LooseTool = { type?: string; destinations?: Array<{ number?: string; transferPlan?: { mode?: string } }> };
const SERVER = "https://nickstire.org/api/webhooks/vapi";
const transferNumber = (cfg: unknown): string | undefined =>
  ((cfg as { model: { tools: LooseTool[] } }).model.tools.find((t) => t.type === "transferCall")?.destinations ?? [])[0]?.number;

describe("wave-141 · preserveLiveTransferDestinations", () => {
  it("carries the live (dashboard) transfer number over the code default", () => {
    const cfg = buildAssistantConfig(SERVER);
    const codeDefault = transferNumber(cfg);
    preserveLiveTransferDestinations(cfg, [
      { type: "transferCall", destinations: [{ type: "number", number: "+12166122782", message: "Hold on, I'll get you over to the manager." }] },
    ]);
    expect(transferNumber(cfg)).toBe("+12166122782");
    expect(transferNumber(cfg)).not.toBe(codeDefault); // proves the merge actually mutated
  });

  // 2026-10-21: the live message was still the retired stacked-filler line, kept
  // alive only by this merge. Number, description and transferPlan stay live;
  // the spoken line comes from code.
  it("takes the spoken message from code, never the live value", () => {
    const cfg = buildAssistantConfig(SERVER);
    preserveLiveTransferDestinations(cfg, [
      { type: "transferCall", destinations: [{ type: "number", number: "+12166122782", message: "Hold on, I'll get you over to the manager.", description: "live desc", transferPlan: { mode: "warm-transfer-say-message", message: "Live intro." } }] },
    ]);
    const dest = (cfg as { model: { tools: Array<LooseTool & { destinations?: Array<Record<string, unknown>> }> } }).model.tools.find((t) => t.type === "transferCall")!.destinations![0];
    expect(dest.message).toBe("Connecting you to the shop now.");
    expect(dest).toMatchObject({ number: "+12166122782", description: "live desc", transferPlan: { message: "Live intro." } });
  });

  it("keeps the code default when the live assistant has no transferCall tool", () => {
    const cfg = buildAssistantConfig(SERVER);
    const codeDefault = transferNumber(cfg);
    preserveLiveTransferDestinations(cfg, [{ type: "function", function: { name: "shopInfo" } } as Record<string, unknown>]);
    expect(transferNumber(cfg)).toBe(codeDefault);
  });

  it("keeps the code default when live destinations are empty", () => {
    const cfg = buildAssistantConfig(SERVER);
    const codeDefault = transferNumber(cfg);
    preserveLiveTransferDestinations(cfg, [{ type: "transferCall", destinations: [] }]);
    expect(transferNumber(cfg)).toBe(codeDefault);
  });

  it("preserves a dashboard-set transferPlan (no silent revert to blind transfer)", () => {
    const cfg = buildAssistantConfig(SERVER);
    preserveLiveTransferDestinations(cfg, [
      { type: "transferCall", destinations: [{ type: "number", number: "+12166122782", transferPlan: { mode: "warm-transfer-say-message", message: "Connecting." } }] },
    ]);
    const tool = (cfg as { model: { tools: LooseTool[] } }).model.tools.find((t) => t.type === "transferCall");
    expect(tool?.destinations?.[0]?.transferPlan?.mode).toBe("warm-transfer-say-message");
  });
});
