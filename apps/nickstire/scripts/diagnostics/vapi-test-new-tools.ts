/**
 * End-to-end smoke test for the wave-179/180/181 voice-agent tools.
 *
 * Runs each tool against live data (customers + alg_estimates +
 * bookings tables) via the same internal caller path the Vapi
 * webhook uses. Doesn't fake a call — exercises the real procedure
 * code with real DB state.
 *
 * Test plan:
 *   1. lookupCustomer       — pick a real customer phone, verify match
 *   2. lookupCustomer       — unknown phone, verify {found:false}
 *   3. getDeclinedEstimate  — pick a phone with an unmatched estimate
 *   4. getCurrentWaitTime   — verify returns valid load + waitMinutes
 *   5. checkTireStock       — synthesize a rack-check, verify lead row
 *   6. Verify live Vapi config has all 11 tools we expect
 *
 * Run: pnpm tsx scripts/vapi-test-new-tools.ts
 */

import "dotenv/config";

const VAPI_BASE = "https://api.vapi.ai";
const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const EXPECTED_TOOLS = [
  "transferCall",
  "tireSizeFromVehicle",
  "tireInquiry",
  "shopInfo",
  "capacityCheck",
  "escalate",
  "sendConfirmationSms",
  "lookupCustomer",
  "getDeclinedEstimate",
  "getCurrentWaitTime",
  "checkTireStock",
];

type TestResult = { name: string; passed: boolean; detail: string };
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✅" : "❌"} ${name} · ${detail}`);
}

async function main() {
  console.log("\n═══ Voice-Agent Tool Smoke Test ═══\n");

  // ─── Test 6: live Vapi config (run first, no DB needed) ───
  console.log("Test 6: Live Vapi assistant config matches code");
  {
    const apiKey = process.env.VAPI_API_KEY;
    if (!apiKey) {
      record("vapi-config", false, "VAPI_API_KEY not set");
    } else {
      const res = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        record("vapi-config", false, `fetch failed ${res.status}`);
      } else {
        const data = (await res.json()) as { model?: { tools?: Array<{ type: string; function?: { name: string } }> } };
        const tools = (data.model?.tools || []).map((t) => t.type === "function" ? t.function?.name || "unknown" : t.type);
        const missing = EXPECTED_TOOLS.filter((e) => !tools.includes(e));
        const extra = tools.filter((t) => !EXPECTED_TOOLS.includes(t));
        if (missing.length === 0 && extra.length === 0) {
          record("vapi-config", true, `all ${EXPECTED_TOOLS.length} tools present`);
        } else {
          record("vapi-config", false, `missing=[${missing.join(",")}] extra=[${extra.join(",")}]`);
        }
      }
    }
  }

  // ─── Tests 1-5: backend procedures via internal caller ───
  const { voiceAgentRouter } = await import("../../server/routers/voiceAgent");
  const caller = voiceAgentRouter.createCaller({
    user: null,
    isVoiceAgentInternal: true,
  } as never);

  // ─── Find a real customer phone for tests 1+3 ───
  const { db } = await import("../../server/lib/db-helper");
  const { customers, algEstimates } = await import("../../drizzle/schema");
  const { isNotNull, isNull, desc, and } = await import("drizzle-orm");
  const d = await db();
  if (!d) {
    console.error("DB unavailable — aborting tests 1-5");
    process.exit(1);
  }

  console.log("\nTest 1: lookupCustomer · known phone");
  const [knownCustomer] = await d
    .select({ phone: customers.phone, firstName: customers.firstName, lastVisitDate: customers.lastVisitDate })
    .from(customers)
    .where(isNotNull(customers.lastVisitDate))
    .orderBy(desc(customers.lastVisitDate))
    .limit(1);
  if (knownCustomer) {
    try {
      const r = await caller.lookupCustomer({ phone: knownCustomer.phone });
      const ok = r.found === true && (r as { firstName?: string }).firstName === knownCustomer.firstName;
      record("lookupCustomer-known", ok, ok ? `matched ${knownCustomer.firstName} from phone ${knownCustomer.phone.slice(-4).padStart(7, "•")}` : `unexpected: ${JSON.stringify(r).slice(0, 150)}`);
    } catch (err) {
      record("lookupCustomer-known", false, `threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    record("lookupCustomer-known", false, "no customer with lastVisitDate found in DB");
  }

  console.log("\nTest 2: lookupCustomer · unknown phone (should return found:false)");
  try {
    const r = await caller.lookupCustomer({ phone: "5559999999" });
    record("lookupCustomer-unknown", r.found === false, `result: ${JSON.stringify(r).slice(0, 100)}`);
  } catch (err) {
    record("lookupCustomer-unknown", false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\nTest 3: getDeclinedEstimate · phone with unmatched ALG estimate");
  const [knownEstimate] = await d
    .select({ phone: algEstimates.customerPhone, externalId: algEstimates.externalId, amount: algEstimates.estimatedAmount })
    .from(algEstimates)
    .where(and(isNull(algEstimates.matchedInvoiceId), isNotNull(algEstimates.customerPhone)))
    .orderBy(desc(algEstimates.estimateDate))
    .limit(1);
  if (knownEstimate?.phone) {
    try {
      const r = await caller.getDeclinedEstimate({ phone: knownEstimate.phone });
      const ok = r.found === true && typeof (r as { estimateDollars?: number }).estimateDollars === "number";
      record("getDeclinedEstimate-known", ok, ok ? `$${(r as { estimateDollars: number }).estimateDollars} estimate · id=${knownEstimate.externalId}` : `unexpected: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (err) {
      record("getDeclinedEstimate-known", false, `threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    record("getDeclinedEstimate-known", false, "no unmatched estimate with phone in DB");
  }

  console.log("\nTest 4: getCurrentWaitTime · no input");
  try {
    const r = await caller.getCurrentWaitTime();
    const ok = r.available === true && typeof (r as { activeBookings?: number }).activeBookings === "number";
    record("getCurrentWaitTime", ok, ok ? `load=${(r as { load: string }).load} · ${(r as { activeBookings: number }).activeBookings} active · ${(r as { estimatedWaitMinutes: number }).estimatedWaitMinutes}min wait` : JSON.stringify(r).slice(0, 150));
  } catch (err) {
    record("getCurrentWaitTime", false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\nTest 5: checkTireStock · synthesize rack-check lead");
  const testPhone = `555000${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
  try {
    const r = await caller.checkTireStock({
      name: "VOICE_AGENT_TEST_DELETE_ME",
      phone: testPhone,
      tireSize: "225/65R17",
      vehicle: "2017 Honda CR-V (test)",
    });
    if (r.success === true) {
      const { leads } = await import("../../drizzle/schema");
      const { eq, and: andOp } = await import("drizzle-orm");
      const [row] = await d.select().from(leads).where(andOp(eq(leads.phone, testPhone), eq(leads.utmCampaign, "vapi-rack-check"))).limit(1);
      if (row && row.urgencyScore === 5 && row.problem?.toLowerCase().includes("physical rack check requested")) {
        record("checkTireStock", true, `lead id=${row.id} urgency=5 utmCampaign=vapi-rack-check`);
        // Clean up the test row
        const { lt } = await import("drizzle-orm");
        await d.delete(leads).where(andOp(eq(leads.phone, testPhone), lt(leads.id, row.id + 1)));
        console.log("  · cleaned up test lead row");
      } else {
        record("checkTireStock", false, `lead row missing or wrong shape: ${JSON.stringify(row).slice(0, 200)}`);
      }
    } else {
      record("checkTireStock", false, `procedure returned success=false: ${JSON.stringify(r)}`);
    }
  } catch (err) {
    record("checkTireStock", false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── Summary ───
  console.log("\n═══ Summary ═══");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`${passed} / ${total} tests passed`);
  if (passed === total) {
    console.log("🎉 All smoke tests passed — voice-agent backend is healthy.\n");
    process.exit(0);
  } else {
    console.log("⚠️  Failures above. Investigate before declaring the wave done.\n");
    process.exit(1);
  }
}

main().catch((e: Error) => {
  console.error("FATAL:", e.message, e.stack);
  process.exit(1);
});
