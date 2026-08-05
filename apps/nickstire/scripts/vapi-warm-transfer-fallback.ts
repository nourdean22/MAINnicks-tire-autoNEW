/**
 * vapi-warm-transfer-fallback.ts — OPERATOR-RUN change of the live
 * receptionist's transfer plan, with snapshot + rollback.
 *
 * WHY (measured 2026-08-05, see docs/runbooks/vapi-warm-transfer-fallback.md)
 * The live plan is `warm-transfer-say-message`: on transfer VAPI parks the
 * caller, dials the destination, and announces. That mode has NO fallback —
 * when nobody answers, the caller holds up to dialTimeout (default 60s) and
 * is dropped, invisibly: the call record was already stamped
 * "assistant-forwarded-call" at hand-off (failedTransfers measured 0 of
 * 1,020 forwards in 90d) and 28% of forwards are redialed within 15 minutes.
 *
 * WHAT THIS CHANGES
 * transferPlan.mode -> "warm-transfer-experimental", which supports
 * `fallbackPlan`: if the destination doesn't answer, the ASSISTANT RETURNS
 * to the caller, apologizes, and captures a callback instead of stranding
 * them. dialTimeout lowered 60 -> 25s so callers aren't parked for a minute.
 *
 * SAFETY MODEL
 * - Default run is a DRY RUN: prints current vs target, PATCHes nothing.
 * - `--apply` snapshots the assistant's FULL model.tools to a local JSON
 *   file BEFORE patching; refuses to run if the snapshot can't be written.
 * - `--rollback <snapshot.json>` restores the snapshotted tools verbatim.
 * - The assistant is resolved from EVIDENCE (the assistant that handled the
 *   most recent real inbound call in vapi_call_logs), not by name — the org
 *   contains a stale second "Receptionist". `--assistant <uuid>` overrides.
 *
 * Usage (from apps/nickstire):
 *   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts                # dry run
 *   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --apply
 *   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --rollback vapi-snapshots/<file>.json
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VAPI_BASE = "https://api.vapi.ai";
const SNAPSHOT_DIR = path.resolve(SCRIPT_DIR, "..", "vapi-snapshots");

// The announce spoken to whoever answers at the shop (kept from live config).
const DEFAULT_ANNOUNCE =
  "You've got a customer holding on the Nick's Tire and Auto line. Connecting you now.";
// What the assistant says to the CALLER when the shop doesn't pick up.
// endCallEnabled:false → the assistant resumes the conversation, and the
// prompt's CALLBACK CAPTURE flow takes it from there.
const FALLBACK_MESSAGE =
  "Sorry about that — nobody could grab the line at the counter just now. " +
  "Give me your name and best number and I'll make sure the shop calls you right back.";
const DIAL_TIMEOUT_SEC = 25;

function envVal(name: string): string | null {
  if (process.env[name]) return process.env[name]!;
  try {
    const raw = fs.readFileSync(path.resolve(SCRIPT_DIR, "..", ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^${name}\\s*=\\s*(.+)\\s*$`));
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env — env-only mode */ }
  return null;
}

const redact = (s: string): string => s.replace(/\+?1?\d{7}(\d{4})/g, "xxx-xxx-$1");

async function vapiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const key = envVal("VAPI_API_KEY");
  if (!key) throw new Error("VAPI_API_KEY not available (env or .env)");
  const res = await fetch(`${VAPI_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`VAPI ${init?.method ?? "GET"} ${pathname} -> HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json() as Promise<T>;
}

/** Evidence-based resolution: the assistant that handled the newest inbound call. */
async function resolveAssistantIdFromEvidence(): Promise<string> {
  const dbUrl = envVal("DATABASE_URL");
  if (!dbUrl) throw new Error("No DATABASE_URL to resolve the live assistant from call evidence — pass --assistant <uuid>");
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool({ uri: dbUrl, connectionLimit: 1 });
  try {
    const [rows] = await pool.query(
      "SELECT vapiCallId FROM vapi_call_logs ORDER BY createdAt DESC LIMIT 1",
    );
    const callId = (rows as Array<{ vapiCallId: string }>)[0]?.vapiCallId;
    if (!callId) throw new Error("vapi_call_logs is empty — pass --assistant <uuid>");
    const call = await vapiFetch<{ assistantId?: string }>(`/call/${callId}`);
    if (!call.assistantId) throw new Error(`Call ${callId} carries no assistantId — pass --assistant <uuid>`);
    return call.assistantId;
  } finally {
    await pool.end();
  }
}

interface AssistantModel { tools?: Array<Record<string, unknown>>; [k: string]: unknown }
interface Assistant { id: string; name?: string; updatedAt?: string; model?: AssistantModel }

async function patchTools(assistantId: string, model: AssistantModel, tools: Array<Record<string, unknown>>): Promise<void> {
  await vapiFetch(`/assistant/${assistantId}`, {
    method: "PATCH",
    body: JSON.stringify({ model: { ...model, tools } }),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rollbackIdx = args.indexOf("--rollback");
  const rollbackFile = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;
  const assistantArgIdx = args.indexOf("--assistant");
  const assistantArg = assistantArgIdx >= 0 ? args[assistantArgIdx + 1] : null;

  const assistantId = assistantArg ?? await resolveAssistantIdFromEvidence();
  const assistant = await vapiFetch<Assistant>(`/assistant/${assistantId}`);
  console.log(`assistant: ${assistant.name} (${assistantId}) · last updated ${assistant.updatedAt}`);

  const tools = (assistant.model?.tools ?? []).slice();
  const idx = tools.findIndex((t) => t.type === "transferCall");
  if (idx < 0) throw new Error("Assistant has no transferCall tool — wrong assistant? Refusing.");

  // ── ROLLBACK ────────────────────────────────────────────────
  if (rollbackFile) {
    const snap = JSON.parse(fs.readFileSync(rollbackFile, "utf8")) as {
      assistantId: string; tools: Array<Record<string, unknown>>;
    };
    if (snap.assistantId !== assistantId) {
      throw new Error(`Snapshot is for assistant ${snap.assistantId}, but target is ${assistantId}. Refusing.`);
    }
    await patchTools(assistantId, assistant.model ?? {}, snap.tools);
    console.log("ROLLED BACK: model.tools restored from snapshot verbatim.");
    return;
  }

  const destinations = (tools[idx].destinations as Array<Record<string, unknown>>) ?? [];
  const numberIdx = destinations.findIndex((d) => d.type === "number");
  if (numberIdx < 0) throw new Error("transferCall tool has no number destination. Refusing.");
  const dest = destinations[numberIdx];
  const currentPlan = (dest.transferPlan as Record<string, unknown> | undefined) ?? {};

  const targetPlan: Record<string, unknown> = {
    mode: "warm-transfer-experimental",
    message: (currentPlan.message as string) ?? DEFAULT_ANNOUNCE,
    ...(currentPlan.sipVerb ? { sipVerb: currentPlan.sipVerb } : {}),
    dialTimeout: DIAL_TIMEOUT_SEC,
    fallbackPlan: {
      message: FALLBACK_MESSAGE,
      endCallEnabled: false,
    },
  };

  console.log("\nCURRENT destination:", redact(JSON.stringify({ number: dest.number, message: dest.message, transferPlan: currentPlan }, null, 2)));
  console.log("\nTARGET transferPlan:", JSON.stringify(targetPlan, null, 2));
  console.log("(destination number and pre-transfer message are NOT changed)");

  if (!apply) {
    console.log("\nDRY RUN — nothing patched. Re-run with --apply to execute (snapshot is taken first).");
    return;
  }

  // ── SNAPSHOT (mandatory before any write) ───────────────────
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapPath = path.join(SNAPSHOT_DIR, `${assistantId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(snapPath, JSON.stringify({ assistantId, takenAt: new Date().toISOString(), tools }, null, 2));
  const readBack = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  if (!Array.isArray(readBack.tools) || readBack.tools.length !== tools.length) {
    throw new Error("Snapshot verification failed — NOT patching.");
  }
  console.log(`\nSnapshot written + verified: ${snapPath}`);

  const newDest = { ...dest, transferPlan: targetPlan };
  const newDestinations = destinations.map((d, i) => (i === numberIdx ? newDest : d));
  tools[idx] = { ...tools[idx], destinations: newDestinations };
  await patchTools(assistantId, assistant.model ?? {}, tools);

  // Verify by reading back
  const after = await vapiFetch<Assistant>(`/assistant/${assistantId}`);
  const afterPlan = ((after.model?.tools ?? []).find((t) => t.type === "transferCall") as any)
    ?.destinations?.find((d: any) => d.type === "number")?.transferPlan;
  console.log("\nAPPLIED. Read-back transferPlan:", JSON.stringify(afterPlan, null, 2));
  console.log(`Rollback at any time:\n  pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --assistant ${assistantId} --rollback "${snapPath}"`);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
