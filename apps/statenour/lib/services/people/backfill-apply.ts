/**
 * People W1 apply core (2026-10-30, manager ruling C). Pure: the DB work arrives as `deps`.
 *
 * The plan lives in a LOCAL file the runner names, never in production before
 * Nour's yes and never in the public repo. Its token is a short sha256 of that
 * file, so --execute can only write the exact bytes that were reviewed.
 * The order is the safety, and `scripts/people-backfill.ts` only wires it:
 *   1. parseApplyArgs: a dry run unless --plan --out <path>, or --execute with
 *      BOTH --plan-file <path> and --token <t>; anything else throws (exit 2,
 *      before any connection);
 *   2. the file's own hash must equal the token, or nothing happens;
 *   3. the ledger is backed up and the backup count must match the source;
 *   4. only then each row, through the once-per-window seam.
 * The file holds ids, kind and times only: no names, no notes.
 */
import { createHash } from "node:crypto";

import type { PlannedChatRow } from "./backfill-plan";

export type ApplyArgs =
  /** withModel: the opt-in digest step (each call writes one AgentTrace row; Codex on 3419). */
  | { mode: "dry"; limit: number; withModel: boolean }
  | { mode: "plan"; limit: number; out: string }
  | { mode: "execute"; planFile: string; token: string };

/** The value after `flag`, or null when the flag is missing or followed by another flag. */
function valueOf(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  const v = at >= 0 ? argv[at + 1] : undefined;
  return v && !v.startsWith("--") ? v : null;
}

export function parseApplyArgs(argv: readonly string[]): ApplyArgs {
  if (argv.includes("--apply")) throw new Error("--apply is retired: use --plan --out <file>, then --execute --plan-file <file> --token <t>");
  const limit = Math.max(1, Number(valueOf(argv, "--limit")) || 20);
  if (argv.includes("--execute")) {
    const planFile = valueOf(argv, "--plan-file");
    if (!planFile) throw new Error("--execute needs --plan-file <the file the --plan run wrote>");
    const token = valueOf(argv, "--token");
    if (!token) throw new Error("--execute needs --token <the token the --plan run printed>");
    return { mode: "execute", planFile, token };
  }
  if (argv.includes("--plan")) {
    const out = valueOf(argv, "--out");
    if (!out) throw new Error("--plan needs --out <a local file path>");
    return { mode: "plan", limit, out };
  }
  return { mode: "dry", limit, withModel: argv.includes("--with-model") };
}

/** Short sha256 of the plan file's exact contents. */
export function fileToken(contents: string): string {
  return createHash("sha256").update(contents).digest("hex").slice(0, 12);
}

export interface ApplyDeps {
  /** Copies the ledger to its backup table; returns both row counts. */
  backup(): Promise<{ source: number; backup: number }>;
  /** Writes one row through the seam; "skipped" when the window already holds one. */
  insert(row: PlannedChatRow): Promise<"inserted" | "skipped">;
}

export type ApplyResult =
  | { status: "token_mismatch"; fileToken: string }
  | { status: "backup_mismatch"; backup: { source: number; backup: number } }
  | {
      status: "applied";
      inserted: number;
      skipped: number;
      failed: number;
      /** backfillKeys only (conversation + person ids), never a name. */
      failures: string[];
      backup: { source: number; backup: number };
    };

export async function runApply(args: { planFile: string; token: string; deps: ApplyDeps }): Promise<ApplyResult> {
  const actual = fileToken(args.planFile);
  if (args.token !== actual) return { status: "token_mismatch", fileToken: actual };
  const plan = deserializePlan(args.planFile);

  const backup = await args.deps.backup();
  if (backup.source !== backup.backup) return { status: "backup_mismatch", backup };

  let inserted = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const row of plan) {
    try {
      if ((await args.deps.insert(row)) === "inserted") inserted++;
      else skipped++;
    } catch {
      // One bad row (a person deleted since the plan) must not hide what the others did.
      failures.push(row.backfillKey);
    }
  }
  return { status: "applied", inserted, skipped, failed: failures.length, failures, backup };
}

/**
 * The apply's writer: the planner's bounded window, re-checked at write time.
 * NOT recordInteractionOnce: its window is one-sided (any contact after start
 * skips), so a planned row for an old conversation with later contacts would
 * be dropped (Codex P1 on 3419). `contactsBetween` counts CONTACT rows only.
 */
export async function insertWithinWindow(
  row: PlannedChatRow,
  io: {
    contactsBetween(personId: string, start: Date, end: Date): Promise<number>;
    write(row: PlannedChatRow): Promise<void>;
  },
): Promise<"inserted" | "skipped"> {
  if ((await io.contactsBetween(row.personId, row.start, row.at)) > 0) return "skipped";
  await io.write(row);
  return "inserted";
}

export function serializePlan(rows: readonly PlannedChatRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      personId: r.personId,
      conversationId: r.conversationId,
      start: r.start.toISOString(),
      at: r.at.toISOString(),
      interactionKind: r.interactionKind,
      backfillKey: r.backfillKey,
    })),
  );
}

export function deserializePlan(json: string): PlannedChatRow[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("plan file is not a list");
  return raw.map((r, i) => {
    const o = r as Record<string, unknown>;
    const at = new Date(String(o.at));
    const start = new Date(String(o.start));
    if (
      typeof o.personId !== "string" ||
      typeof o.conversationId !== "string" ||
      typeof o.backfillKey !== "string" ||
      !Number.isFinite(at.getTime()) ||
      !Number.isFinite(start.getTime()) ||
      (o.interactionKind !== null && typeof o.interactionKind !== "string")
    ) {
      throw new Error(`plan file row ${i} is malformed`);
    }
    return {
      personId: o.personId,
      conversationId: o.conversationId,
      start,
      at,
      interactionKind: o.interactionKind as string | null,
      backfillKey: o.backfillKey,
    };
  });
}
