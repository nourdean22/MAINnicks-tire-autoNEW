# Tool-Use Guardian Pattern

**Skill port:** A1 · tool-use-guardian
**Applies to:** VAPI tool dispatcher (`apps/nickstire/server/routes/webhooks/vapi.ts`), tRPC voice-agent procedures, Mastra tool calls in statenour, any future LLM tool invocation.
**Authored:** 2026-05-26.

## Why this doc exists

Tool calls are the place where LLM behavior crosses into REAL ACTIONS · DB writes, SMS sends, money movement. Without a guardian layer, an LLM hallucinating a tool call (#285 silent-tool-discard) OR an LLM passing malformed args lands a bad write before anyone notices.

Audit caught this class · the voice agent claimed bookings without firing `bookSlot`. Wave R voice-agent eval rubric scores it · this doc defines the structural fix.

## The 5-step guardian wrapper

Every tool invocation goes through these 5 checks BEFORE the actual handler runs:

```
1. AUTHENTICATE      · is this caller allowed to invoke this tool?
2. VALIDATE          · do the args parse the tool's zod schema?
3. AUDIT             · write a pre-execution row (tool_audit_log)
4. RATE-LIMIT        · is this tool over its per-tool / per-caller budget?
5. EXECUTE           · run the handler · capture result + duration
                     · update the audit row · return shape: { result, audit_id }
```

If ANY of the first 4 steps fail, the handler never runs. The audit row records the failure reason for observability.

## Per-tool spec shape

Every tool has a structured spec, not just a function:

```typescript
const bookSlotTool = defineTool({
  name: "bookSlot",
  tier: "tier-1",  // see autonomous-action-tiers.md
  description: "Create a booking row from voice-agent input",
  inputSchema: z.object({
    name: z.string().min(2).max(200),
    phone: z.string().min(7).max(20),
    service: z.string().max(200),
    preferredDay: z.string().max(20).optional(),
    callId: z.string().max(100).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    reference: z.string().optional(),
    error: z.string().optional(),
  }),
  rateLimit: {
    perCaller: 10,    // max 10 invocations per VAPI call session
    perWindow: 5000,  // max 5000 invocations per day across the system
  },
  audit: {
    logBefore: ["name", "phone-last-4", "service"],  // PII-scrubbed fields to log
    logAfter: ["success", "reference"],
  },
  handler: async (input) => { /* actual implementation */ },
});
```

The guardian wraps `defineTool` · the handler ONLY sees validated, authenticated input.

## What the audit catches

| Failure mode | Pre-guardian | Post-guardian |
|---|---|---|
| LLM hallucinates a tool call | Silent "done!" → no DB write | Pre-execution audit row written · post-row missing → flagged |
| LLM passes invalid arg shape | Handler crashes mid-write OR coerces wrong | Validation step rejects · returns structured error to LLM |
| LLM spams tool | Real customer DB grows · rate-limit fires too late | Rate-limit at step 4 · returns "throttled" without touching DB |
| Compromised LLM session calls privileged tool | Tool fires | Auth step rejects |
| Tool itself has a bug | Bad data lands silently | Output schema mismatch detected · row flagged as "wrote but invalid output" |

## Anti-patterns

### "Trust the LLM's args"

Never. Zod-parse everything. The LLM is a stochastic input source · treat it like an untrusted user.

### "Skip audit for read-only tools"

Read-only tools STILL get an audit row. Reads reveal patterns (intent capture rate, tool selection distribution) that drive eval scoring (Wave R rubric).

### "Aggregate audit at end of run"

Audit BEFORE the action, not after. Pre-action audit row + post-action update is the pattern that catches silent discards. Post-only auditing fails open · the bug you're trying to catch is "the action didn't happen but I claim it did" · only a PRE row exposes that.

### "Tier-0 tool without dry-run mode"

Every Tier-0 tool (per autonomous-action-tiers.md) needs `{ dryRun: true }` opt-in. Tests, agent-of-agents flows, and operator preview UIs use dry-run. Real production calls don't pass the flag.

## Implementation plan (queued for next session)

1. Create `apps/nickstire/server/lib/tool-guardian.ts` · the `defineTool` factory + the 5-step wrapper
2. Migrate `bookSlot`, `tireInquiry`, `escalate`, `sendConfirmationSms`, `capacityCheck`, `quoteRange` from `voiceAgent.ts` to use `defineTool`
3. Create `tool_audit_log` migration (id, tool_name, caller, args_json, result_json, status, duration_ms, created_at, completed_at)
4. Update VAPI webhook dispatchToolCall to use the guardian
5. Add an admin page at `/admin/tool-audit` to surface the log
6. Add a daily cron that flags `pre-row-without-post-row` audit entries (the silent-discard detector)

## Skill-port lineage

A1 from the audit's Round 2 deep-pass. Codifies the framework · implementation is queued. Pairs with:
- Wave R · voice-agent eval rubric (scores tools that DIDN'T guardian-fail)
- Wave V · autonomous-action tiers (each tool has a tier classification)
- Audit #285 (silent-tool-discard) · this is the structural fix

Future extensions · agent-tool-builder skill (A4) provides the design framework for NEW tools (input/output schemas, error paths, retries). Combined with guardian = full tool lifecycle.
