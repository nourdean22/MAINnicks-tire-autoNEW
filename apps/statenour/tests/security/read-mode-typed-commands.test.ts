/**
 * tests/security/read-mode-typed-commands.test.ts · 2026-09-07
 *
 * The read-mode CONTRACT, chosen and pinned (audit D15 / Report C F8):
 *
 *   "read" means NO AUTONOMOUS CHANGES — the model cannot run a mutating
 *   tool (stripMutatingTools removes them from the request, covered by
 *   tests/security/agentic-redteam.test.ts) — while a command the operator
 *   TYPES (`/save …`, "remember that …") is the operator's own authority and
 *   executes regardless of the mode.
 *
 * It is NOT "read-only". The interceptor fast paths are permission-blind by
 * design: InterceptArgs carries no permission field, and the typed command
 * is the authorization. Quoted or retrieved text is never a command — only
 * the operator's own last message reaches the interceptors.
 *
 * This file pins the typed-command half. If someone later decides on the
 * strict "read-only" product instead, this test must change WITH the label
 * and the docs — never quietly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const save = vi.hoisted(() => ({ saveToBrain: vi.fn() }));
vi.mock("@/lib/services/brain/save", () => ({ saveToBrain: save.saveToBrain }));

const shared = vi.hoisted(() => ({ buildFastStream: vi.fn() }));
vi.mock("@/lib/ai/chat/handlers/shared", () => ({ buildFastStream: shared.buildFastStream }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { handleSlashSave } from "@/lib/ai/chat/handlers/brain-dump";

describe("read mode · typed commands are the operator's authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    save.saveToBrain.mockResolvedValue({
      id: "bm-1",
      category: "user_save",
      key: "user_save_1",
      summary: "Saved as user_save · Rent is $1,900",
      outcome: "created",
      embedded: true,
    });
    shared.buildFastStream.mockImplementation(async (_conv: string, text: string) => new Response(text));
  });

  it("a typed /save executes with no permission argument in the path (there is none to pass)", async () => {
    const res = await handleSlashSave("conv-1", "/save Rent is $1,900");
    expect(save.saveToBrain).toHaveBeenCalledWith({ content: "Rent is $1,900", source: "chat:/save" });
    expect(await res.text()).toContain("**Saved**");
  });

  it("the interceptor contract carries no permission field — fast paths are permission-blind by design", () => {
    const src = readFileSync(resolve(APP_ROOT, "lib/ai/chat/interceptors.ts"), "utf8");
    const block = src.slice(src.indexOf("export interface InterceptArgs"), src.indexOf("export type InterceptResult"));
    expect(block).toMatch(/userContent: string/);
    expect(block).not.toMatch(/[pP]ermission/);
  });

  it("the gate documents the contract next to the permission it parses", () => {
    const gate = readFileSync(resolve(APP_ROOT, "lib/ai/chat/gate.ts"), "utf8");
    expect(gate).toMatch(/NO AUTONOMOUS CHANGES/);
    expect(gate).toMatch(/typed command/i);
  });
});
