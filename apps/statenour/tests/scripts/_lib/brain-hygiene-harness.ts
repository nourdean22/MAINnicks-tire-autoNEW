/**
 * Shared test harness for scripts/brain-hygiene/*: a recording fake Db and a spawn helper that runs the
 * REAL script under a preload that exits 97 on any network attempt.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@/scripts/brain-hygiene/_run";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRELOAD = join(APP_ROOT, "tests/scripts/_lib/no-network.cjs");

export interface Call {
  kind: "query" | "exec";
  sql: string;
  params: unknown[];
}

/** A Db that records every statement and answers through `answer`. Unanswered statements throw, so a surprise write is loud. */
export function fakeDb(answer: (sql: string, params: unknown[], kind: "query" | "exec") => unknown): { db: Db; calls: Call[] } {
  const calls: Call[] = [];
  const db: Db = {
    async query(sql, ...params) {
      calls.push({ kind: "query", sql, params });
      return answer(sql, params, "query") as never;
    },
    async exec(sql, ...params) {
      calls.push({ kind: "exec", sql, params });
      return answer(sql, params, "exec") as never;
    },
  };
  return { db, calls };
}

export const normalize = (sql: string): string => sql.replace(/\s+/g, " ").trim();

/** Spawn a script with a bogus DATABASE_URL and the no-network preload. Never forwards the real env URL. */
export function spawnScript(rel: string, args: string[]): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgres://hygiene:secret-pw@invalid.invalid/x" };
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require ${PRELOAD}`.trim();
  const r = spawnSync(process.execPath, [join(APP_ROOT, "node_modules/tsx/dist/cli.mjs"), join(APP_ROOT, rel), ...args], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\nSPAWN_ERROR:${r.error.message}` : ""}` };
}
