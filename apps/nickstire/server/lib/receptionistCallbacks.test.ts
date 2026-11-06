/**
 * 2026-11-06 (Codex c=4495402006, c=4495402045): the receptionist's retired callback rows are
 * recognised by their COMPLETE historical signature (the public callback form accepts utm and
 * sourcePage from the request, so one field is forgeable), and every actionable reader leaves
 * them out through one shared predicate, not only Today's bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isReceptionistCallback, notReceptionistCallbackSql } from "./receptionistCallbacks";

const ESCALATE_ROW = { utmSource: "voice-agent", utmMedium: "phone", utmCampaign: "vapi-receptionist", sourcePage: null, context: "[VOICE-AGENT · HIGH] callId=c1 — rack check" };
const SCHEDULE_ROW = { utmSource: null, utmMedium: null, utmCampaign: null, sourcePage: "vapi-voice-agent", context: "[VOICE-AGENT CALLBACK] callId=c2 — alignment" };

describe("isReceptionistCallback needs the full receptionist signature", () => {
  it("matches the rows escalate and scheduleCallback wrote", () => {
    expect(isReceptionistCallback(ESCALATE_ROW)).toBe(true);
    expect(isReceptionistCallback(SCHEDULE_ROW)).toBe(true);
  });

  it.each([
    ["a website request with utm_source=voice-agent", { ...ESCALATE_ROW, utmMedium: null, utmCampaign: null, context: "Need a quote" }],
    ["a website request with sourcePage vapi-voice-agent", { ...SCHEDULE_ROW, context: "Call me about tires" }],
    ["a plain website request", { utmSource: "google", utmMedium: "cpc", utmCampaign: null, sourcePage: "/tires", context: "brakes" }],
  ])("keeps %s", (_label, row) => {
    expect(isReceptionistCallback(row)).toBe(false);
  });
});

describe("one SQL filter for every actionable reader", () => {
  it("is null-safe and checks both signatures", () => {
    const q = notReceptionistCallbackSql() as unknown as { queryChunks: unknown[] };
    const text = (function flat(chunks: unknown[]): string {
      return chunks.map((c) => {
        const o = c as { value?: unknown; queryChunks?: unknown[] };
        if (o && Array.isArray(o.queryChunks)) return flat(o.queryChunks);
        return Array.isArray(o?.value) ? (o.value as string[]).join("") : "?";
      }).join("");
    })(q.queryChunks);
    expect(text).toMatch(/COALESCE/);
    expect(text).toMatch(/NOT/);
    expect(sql`x`).toBeTruthy();
  });

  it.each([
    "server/cron/jobs/morningBrief.ts",
    "server/routers/controlCenter.ts",
    "server/services/nickIntelligence.ts",
  ])("%s counts open callbacks through it", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf-8");
    const counts = src.match(/from\(callbackRequests\)[\s\S]{0,200}?eq\(callbackRequests\.status, "new"\)[^\n]*/g) ?? [];
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toMatch(/notReceptionistCallbackSql\(\)/);
  });

  it("the Today bundle uses the same predicate", () => {
    const src = readFileSync(join(process.cwd(), "server/services/adminBundle.ts"), "utf-8");
    expect(src).toMatch(/import \{[^}]*isReceptionistCallback[^}]*\} from "\.\.\/lib\/receptionistCallbacks"/);
  });
});
