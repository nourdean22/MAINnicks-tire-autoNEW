/**
 * VAPI synthetic-call harness · 2026-05-18 PM.
 *
 * Why this exists · wave-181.50 root-caused a 5-day silent loss of all
 * VAPI tool calls because the nested `server.url` field on the inbound
 * assistant was unset. Same root cause was sitting on the follow-up
 * assistant until wave-181.60-followup. Telegram had zero signal · the
 * agent kept "working" from the caller's perspective but every booking
 * webhook silently disappeared.
 *
 * This harness catches THAT class of bug in <24h instead of 5 days.
 *
 * Strategy · run THREE checks against the live system:
 *   1. Config drift · fetch both assistant configs from VAPI · assert
 *      `serverUrl` (legacy) + `server.url` (current) match expected +
 *      each tool URL points to nickstire.org. (`server.secret` is NOT
 *      asserted: VAPI's GET /assistant never returns secret material —
 *      the current API Server schema has no secret field at all — so a
 *      GET-side assertion is structurally unpassable. Secret correctness
 *      is proven behaviorally by check 2 instead.)
 *   2. Webhook reachability · POST a synthetic status-update payload to
 *      our own /api/webhooks/vapi carrying the plain env secret in
 *      `x-vapi-secret` — exactly what VAPI sends — assert 200. This is
 *      the behavioral proof that env secret + verifier + route agree.
 *   3. Tool dispatcher smoke · POST synthetic tool-call payloads
 *      for 3 read-only tools (shopInfo · capacityCheck · lookupCustomer
 *      with a sentinel phone) · assert each returns the expected shape.
 *
 * 2026-07-07 protocol fix · the harness originally signed payloads with
 * HMAC-SHA256 into `x-vapi-signature`, but commit 452dc386f (2026-05-20)
 * switched the webhook verifier to a constant-time VERBATIM compare of
 * the header against plain VAPI_WEBHOOK_SECRET (VAPI sends the
 * assistant's server.secret verbatim in `x-vapi-secret`). A hex digest
 * can never equal the plain secret, so checks 2+3 401'd on every run
 * since — the harness never passed once. It now sends what VAPI sends.
 *
 * Sentinel data · lookupCustomer uses `5550100000` (reserved test
 * range per RFC 5733) so we don't pollute the customers table.
 *
 * Failure surface · the cron entry throws on any failed check so the
 * `cron_log` row is marked `failed` and `cronSkipWatchdog` catches the
 * failure on its next pass. The cron also fires a Telegram alert
 * inline · belt + suspenders.
 *
 * Drift-proofing · this service is called by both the standalone
 * `scripts/vapi-harness.ts` (manual + Railway one-shot) AND the cron
 * job at `server/cron/jobs/vapiHarness.ts`. Same function, same
 * verdict, no divergence.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("services:vapi-harness");

const VAPI_API_BASE = "https://api.vapi.ai";
const INBOUND_ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const EXPECTED_WEBHOOK_URL = "https://nickstire.org/api/webhooks/vapi";
const SENTINEL_PHONE = "5550100000"; // RFC 5733 reserved test range

export interface HarnessCheck {
  name: string;
  pass: boolean;
  details?: string;
  err?: string;
}

export interface HarnessResult {
  pass: boolean;
  checks: HarnessCheck[];
  summary: string;
}

// ─── Helpers ──────────────────────────────────────────────

async function fetchAssistantConfig(
  assistantId: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${VAPI_API_BASE}/assistant/${assistantId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

// ─── Check 1 · config drift detection ────────────────────

interface AssistantUnderTest {
  id: string;
  label: string;
}

async function checkAssistantConfig(
  assistant: AssistantUnderTest,
  apiKey: string,
): Promise<HarnessCheck[]> {
  const checks: HarnessCheck[] = [];

  let config: Record<string, unknown> | null;
  try {
    config = await fetchAssistantConfig(assistant.id, apiKey);
  } catch (err) {
    return [
      {
        name: `${assistant.label}: fetch config`,
        pass: false,
        err: err instanceof Error ? err.message : String(err),
      },
    ];
  }
  if (!config) {
    return [
      {
        name: `${assistant.label}: fetch config`,
        pass: false,
        err: "VAPI API returned non-OK",
      },
    ];
  }

  // 1a · legacy serverUrl field present + correct
  const serverUrl = config.serverUrl as string | undefined;
  checks.push({
    name: `${assistant.label}: serverUrl matches`,
    pass: serverUrl === EXPECTED_WEBHOOK_URL,
    details: serverUrl ?? "(missing)",
  });

  // 1b · nested server.url field present + correct (the wave-181.50 fix)
  const server = config.server as { url?: string; timeoutSeconds?: number } | undefined;
  checks.push({
    name: `${assistant.label}: server.url matches (wave-181.50 root cause)`,
    pass: server?.url === EXPECTED_WEBHOOK_URL,
    details: server?.url ?? "(missing)",
  });

  // (no server.secret assertion here · VAPI GET /assistant never returns
  // secret material — the current API Server schema has no secret field —
  // so the old "server.secret set" check failed on every run regardless
  // of the real config. The signature roundtrip check proves the secret
  // chain end-to-end instead.)

  // 1c · every tool URL (if set) points to nickstire.org
  const model = config.model as
    | { tools?: Array<{ function?: { name?: string }; server?: { url?: string } }> }
    | undefined;
  const tools = model?.tools ?? [];
  const badTools = tools.filter((t) => {
    const url = t.server?.url;
    return typeof url === "string" && !url.includes("nickstire.org");
  });
  checks.push({
    name: `${assistant.label}: all tool URLs nickstire.org`,
    pass: badTools.length === 0,
    details:
      badTools.length === 0
        ? `${tools.length} tools checked`
        : `${badTools.length} bad: ${badTools.map((t) => t.function?.name ?? "?").join(", ")}`,
  });

  return checks;
}

// ─── Check 2 · webhook reachability + signature roundtrip ─

async function checkWebhookReachability(
  webhookUrl: string,
  secret: string,
): Promise<HarnessCheck> {
  const payload = {
    message: {
      type: "status-update",
      call: {
        id: `harness-${Date.now()}`,
        status: "in-progress",
      },
    },
  };
  const body = JSON.stringify(payload);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // VAPI sends the assistant's server.secret VERBATIM in this
        // header · the verifier constant-time-compares it against env
        // VAPI_WEBHOOK_SECRET (routes/webhooks/vapi.ts · since 452dc386f).
        "x-vapi-secret": secret,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      name: "webhook reachability + signature roundtrip",
      pass: res.ok,
      details: `${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      name: "webhook reachability + signature roundtrip",
      pass: false,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Check 3 · tool dispatcher smoke test ────────────────

interface SyntheticToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

async function checkToolDispatch(
  webhookUrl: string,
  secret: string,
  tool: SyntheticToolCall,
): Promise<{ dispatch: HarnessCheck; state?: HarnessCheck }> {
  // Use a synthetic callId that the state-tracker stamps · the second
  // sub-check reads it back to prove the Phase 4 hook fired.
  const syntheticCallId = `harness-call-${tool.name}-${Date.now()}`;
  const toolCallId = `harness-tc-${tool.name}-${Date.now()}`;
  const payload = {
    message: {
      type: "tool-calls",
      call: { id: syntheticCallId, assistantId: "harness" },
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: tool.name,
            arguments: JSON.stringify(tool.arguments),
          },
        },
      ],
    },
  };
  const body = JSON.stringify(payload);

  let dispatchCheck: HarnessCheck;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Plain secret · same protocol as real VAPI traffic (see check 2).
        "x-vapi-secret": secret,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      dispatchCheck = {
        name: `tool dispatch: ${tool.name}`,
        pass: false,
        details: `${res.status} ${res.statusText}`,
      };
      return { dispatch: dispatchCheck };
    }
    const json = (await res.json()) as { results?: Array<{ toolCallId: string; result: string }> };
    const result = json.results?.find((r) => r.toolCallId === toolCallId);
    if (!result) {
      dispatchCheck = {
        name: `tool dispatch: ${tool.name}`,
        pass: false,
        details: `200 but no toolCallId in response`,
      };
      return { dispatch: dispatchCheck };
    }
    try {
      JSON.parse(result.result);
    } catch {
      dispatchCheck = {
        name: `tool dispatch: ${tool.name}`,
        pass: false,
        details: `200 but result.result is not JSON`,
      };
      return { dispatch: dispatchCheck };
    }
    dispatchCheck = {
      name: `tool dispatch: ${tool.name}`,
      pass: true,
      details: `200 · result length ${result.result.length}`,
    };
  } catch (err) {
    return {
      dispatch: {
        name: `tool dispatch: ${tool.name}`,
        pass: false,
        err: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Phase 4 wave-181.63 · verify the state-tracker hook fired. The
  // recordCallState call is fire-and-forget, so give it a short
  // window to land before reading back. Read directly from the
  // service (same process · no HTTP round-trip needed).
  await new Promise((r) => setTimeout(r, 750));
  let stateCheck: HarnessCheck;
  try {
    const { getCallStateHistory, classifyToolToState } = await import(
      "./voice-call-state"
    );
    const history = await getCallStateHistory(syntheticCallId);
    const expectedState = classifyToolToState(tool.name);
    if (!expectedState) {
      // Tool isn't classified · skip with pass=true (legitimate skip).
      stateCheck = {
        name: `state hook: ${tool.name}`,
        pass: true,
        details: `tool not classified · no state expected`,
      };
    } else {
      const matched = history.find((h) => h.state === expectedState);
      stateCheck = {
        name: `state hook: ${tool.name} → ${expectedState}`,
        pass: !!matched,
        details: matched
          ? `recorded at ${matched.at.toISOString()}`
          : `expected ${expectedState} · found ${history.map((h) => h.state).join(",") || "(none)"}`,
      };
    }
  } catch (err) {
    stateCheck = {
      name: `state hook: ${tool.name}`,
      pass: false,
      err: err instanceof Error ? err.message : String(err),
    };
  }
  return { dispatch: dispatchCheck, state: stateCheck };
}

// ─── Orchestrator ────────────────────────────────────────

export async function runVapiHarness(): Promise<HarnessResult> {
  const apiKey = (process.env.VAPI_API_KEY || "").trim();
  const webhookSecret = (process.env.VAPI_WEBHOOK_SECRET || "").trim();

  // Env preflight · don't run if we can't run honestly. Surface as a
  // single failure so the alert is unambiguous.
  if (!apiKey) {
    return {
      pass: false,
      checks: [
        { name: "preflight: VAPI_API_KEY", pass: false, err: "env var missing" },
      ],
      summary: "VAPI_API_KEY missing · harness cannot run",
    };
  }
  if (!webhookSecret) {
    return {
      pass: false,
      checks: [
        { name: "preflight: VAPI_WEBHOOK_SECRET", pass: false, err: "env var missing" },
      ],
      summary: "VAPI_WEBHOOK_SECRET missing · harness cannot run",
    };
  }

  const assistants: AssistantUnderTest[] = [
    { id: INBOUND_ASSISTANT_ID, label: "inbound" },
  ];
  const followupId = (process.env.VAPI_FOLLOWUP_ASSISTANT_ID || "").trim();
  if (followupId) {
    assistants.push({ id: followupId, label: "followup" });
  }

  const allChecks: HarnessCheck[] = [];

  // Check 1 · config drift across all assistants
  for (const a of assistants) {
    const cfgChecks = await checkAssistantConfig(a, apiKey);
    allChecks.push(...cfgChecks);
  }

  // Check 2 · webhook reachability
  allChecks.push(await checkWebhookReachability(EXPECTED_WEBHOOK_URL, webhookSecret));

  // Check 3 + 4 · tool dispatcher smoke + state-tracker hook
  // verification (read-only tools · no DB writes besides the harness's
  // own state-tracker rows which are isolated by `harness-` callId
  // prefix). The state-hook sub-check proves the Phase 4 wiring fires
  // end-to-end · webhook → dispatcher → state-tracker → DB.
  const syntheticCalls: SyntheticToolCall[] = [
    { name: "shopInfo", arguments: {} },
    { name: "capacityCheck", arguments: {} },
    { name: "lookupCustomer", arguments: { phone: SENTINEL_PHONE } },
  ];
  for (const call of syntheticCalls) {
    const { dispatch, state } = await checkToolDispatch(
      EXPECTED_WEBHOOK_URL,
      webhookSecret,
      call,
    );
    allChecks.push(dispatch);
    if (state) allChecks.push(state);
  }

  const failed = allChecks.filter((c) => !c.pass);
  const summary =
    failed.length === 0
      ? `All ${allChecks.length} checks passed across ${assistants.length} assistant(s).`
      : `${failed.length} of ${allChecks.length} checks FAILED: ${failed.map((c) => c.name).join(" · ")}`;

  log.info("vapi harness complete", {
    total: allChecks.length,
    failed: failed.length,
    pass: failed.length === 0,
  });

  return {
    pass: failed.length === 0,
    checks: allChecks,
    summary,
  };
}
