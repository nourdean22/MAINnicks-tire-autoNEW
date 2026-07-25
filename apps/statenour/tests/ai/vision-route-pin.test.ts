/**
 * tests/ai/vision-route-pin.test.ts — pins the image→vision routing
 * chain end to end (2026-07-25 incident: chat was image-blind in prod;
 * PR #409's consolidation moved detectDomain behind a re-export shim
 * and the vision short-circuit had ZERO coverage — this file makes the
 * whole class of silent loss impossible).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { detectDomain } from "@/lib/ai/domain-routing";
import { detectDomain as detectDomainDirect } from "@/lib/ai/runtime/chat-classifier";
import { resolveProviderModel } from "@/lib/ai/provider";

afterEach(() => vi.unstubAllEnvs());

describe("image → vision routing pin (2026-07-25 incident)", () => {
  it("an image attachment short-circuits to the vision route regardless of text", () => {
    const r = detectDomain("what is this?", { hasImageAttachments: true });
    expect(r.domain).toBe("vision");
    expect(r.taskType).toBe("vision");
  });

  it("image beats even strong text-domain cues (code-looking text + image = vision)", () => {
    const r = detectDomain("refactor this typescript function for me", {
      hasImageAttachments: true,
    });
    expect(r.taskType).toBe("vision");
  });

  it("no image = never vision from plain text", () => {
    const r = detectDomain("what should I do today?");
    expect(r.taskType).not.toBe("vision");
  });

  it("the domain-routing shim re-exports the SAME detectDomain (guard the re-export)", () => {
    expect(detectDomain).toBe(detectDomainDirect);
  });

  it("ollama vision lane reads OLLAMA_VISION_MODEL (the prod-config half of the incident)", () => {
    vi.stubEnv("OLLAMA_VISION_MODEL", "qwen3-vl:235b-instruct");
    expect(resolveProviderModel("ollama", "vision")).toBe("qwen3-vl:235b-instruct");
  });
});
