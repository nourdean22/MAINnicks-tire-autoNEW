/**
 * Canaries for the destructive-seed guard (prisma/seed-guard.ts + prisma/seed.ts).
 *
 * WHAT IS BEING GUARDED. prisma/seed.ts deleteMany()s task_events, tasks,
 * personal_daily_logs and missions before writing demo rows. worktree-setup.ps1
 * copies the PROD DATABASE_URL into every worktree and no local DB exists there,
 * so the DEFAULT target of an unguarded `pnpm db:seed` is production. This is the
 * 870-row-deletion class from the prod-db-guard skill.
 *
 * WHY THESE TESTS LOOK LIKE THIS (guard-red-team):
 *   · Every "refuses" assertion is PAIRED with a positive control proving the
 *     guard still permits the legitimate case. A guard that refuses everything
 *     scores identically to a working one on refusal tests alone.
 *   · The last block probes the REAL binary and asserts on EXIT CODES, not on a
 *     reading of the regex. A pure-function test cannot prove seed.ts actually
 *     CALLS the guard, or that it calls it before the first deleteMany.
 *   · The probe set covers the bypass classes that have historically defeated
 *     matchers here: truthy-but-not-"1" flag values, substring-vs-exact host
 *     matching, credentials containing the delimiter, ports, and query strings.
 *
 * SAFETY. No test may ever point the real binary at a reachable database. The
 * refusal probe uses the reserved `.invalid` TLD (can never resolve) and the
 * pass-through probe uses localhost:1 (nothing listens). If the guard were
 * COMPLETELY broken, both would fail to connect and still destroy nothing.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  hostFromDatabaseUrl,
  isLocalHost,
  seedRefusalReason,
  ALLOW_ENV,
} from "@/prisma/seed-guard";

const REMOTE = "postgresql://user:pw@ep-quiet-example.us-east-1.aws.neon.tech/db?sslmode=require";
const LOCAL = "postgresql://user:pw@localhost:5432/statenour";

/* ── hostFromDatabaseUrl · the parse the whole guard rests on ───────────── */

describe("hostFromDatabaseUrl", () => {
  it("extracts the host and strips credentials, port and query", () => {
    expect(hostFromDatabaseUrl(REMOTE)).toBe("ep-quiet-example.us-east-1.aws.neon.tech");
    expect(hostFromDatabaseUrl(LOCAL)).toBe("localhost");
  });

  // Generated Neon passwords legitimately contain these. A naive indexOf("@")
  // or new URL() would mis-assign the host — and a guard that mis-reads the
  // host reports a remote database as local.
  it("survives credentials containing @ / ? and #", () => {
    expect(hostFromDatabaseUrl("postgresql://u:p@ss@real.neon.tech/db")).toBe("real.neon.tech");
    expect(hostFromDatabaseUrl("postgresql://u:p/w?x@real.neon.tech:5432/db")).toBe("real.neon.tech");
    expect(hostFromDatabaseUrl("postgresql://u:p#h@real.neon.tech/db")).toBe("real.neon.tech");
  });

  it("lowercases the host and keeps IPv6 literals intact", () => {
    expect(hostFromDatabaseUrl("postgresql://u:p@LOCALHOST:5432/db")).toBe("localhost");
    expect(hostFromDatabaseUrl("postgresql://u:p@[::1]:5432/db")).toBe("[::1]");
  });

  it("returns null for unset / empty / scheme-less input", () => {
    expect(hostFromDatabaseUrl(undefined)).toBeNull();
    expect(hostFromDatabaseUrl("")).toBeNull();
    expect(hostFromDatabaseUrl("   ")).toBeNull();
    expect(hostFromDatabaseUrl("not-a-url")).toBeNull();
  });
});

/* ── isLocalHost · exact match, never substring ─────────────────────────── */

describe("isLocalHost", () => {
  it("accepts the real local hosts", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]) {
      expect(isLocalHost(h)).toBe(true);
    }
  });

  // NEGATIVE CONTROL / bypass class: a substring match would treat all three of
  // these as local and wave a remote database straight through.
  it("rejects hosts that merely CONTAIN a local name", () => {
    for (const h of ["localhost.evil.com", "notlocalhost", "127.0.0.1.evil.com", "mylocalhost"]) {
      expect(isLocalHost(h)).toBe(false);
    }
  });

  it("rejects null", () => {
    expect(isLocalHost(null)).toBe(false);
  });
});

/* ── seedRefusalReason · the judge ──────────────────────────────────────── */

describe("seedRefusalReason", () => {
  // POSITIVE CONTROL. Without this, a guard hard-wired to `return "refused"`
  // would pass every other test in this block.
  it("PERMITS a local target with no flag (the intended use)", () => {
    expect(seedRefusalReason({ databaseUrl: LOCAL, allowFlag: undefined })).toBeNull();
    expect(seedRefusalReason({ databaseUrl: "postgresql://u:p@127.0.0.1:5432/db", allowFlag: undefined })).toBeNull();
  });

  it("REFUSES a remote target with no flag, and names the host", () => {
    const reason = seedRefusalReason({ databaseUrl: REMOTE, allowFlag: undefined });
    expect(reason).not.toBeNull();
    expect(reason).toContain("ep-quiet-example.us-east-1.aws.neon.tech");
    expect(reason).toContain(ALLOW_ENV);
  });

  it("PERMITS a remote target once the flag is exactly \"1\"", () => {
    expect(seedRefusalReason({ databaseUrl: REMOTE, allowFlag: "1" })).toBeNull();
  });

  // Bypass class: only the exact string "1" arms it. Anything else is refused,
  // so a stale `ALLOW_DESTRUCTIVE_SEED=true` copied into a worktree .env by
  // worktree-setup.ps1 does NOT silently arm the destructive seed.
  it("REFUSES truthy-looking flag values that are not \"1\"", () => {
    for (const flag of ["true", "yes", "TRUE", "0", "", " 1", "1 ", "01", undefined, null]) {
      expect(seedRefusalReason({ databaseUrl: REMOTE, allowFlag: flag })).not.toBeNull();
    }
  });

  it("REFUSES when the target cannot be identified at all", () => {
    // Unknown is not local. A guard that defaulted to "allow" here would wave
    // through exactly the case where it cannot see what it is about to delete.
    expect(seedRefusalReason({ databaseUrl: undefined, allowFlag: undefined })).not.toBeNull();
    expect(seedRefusalReason({ databaseUrl: "", allowFlag: "1" })).not.toBeNull();
    expect(seedRefusalReason({ databaseUrl: "garbage", allowFlag: "1" })).not.toBeNull();
  });
});

/* ── the REAL binary · exit codes, not opinions ─────────────────────────── */

/**
 * Run prisma/seed.ts in a subprocess with an explicit env. DATABASE_URL is
 * always overridden with an unreachable value, so a broken guard destroys
 * nothing — it just fails to connect.
 */
function runSeed(env: Record<string, string | undefined>) {
  const child = spawnSync("pnpm exec tsx prisma/seed.ts", {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  return {
    status: child.status,
    output: `${child.stdout ?? ""}${child.stderr ?? ""}`,
  };
}

describe("prisma/seed.ts · real binary", () => {
  it(
    "REFUSES a remote target and exits non-zero, without touching the DB",
    () => {
      const { status, output } = runSeed({
        // Reserved TLD — cannot resolve, so even a dead guard reaches no database.
        DATABASE_URL: "postgresql://u:p@seed-guard-canary.invalid:5432/db",
        ALLOW_DESTRUCTIVE_SEED: undefined,
      });
      expect(output).toContain("REFUSED");
      expect(status).not.toBe(0);
      // Ordering proof: the guard returns before any client work, so the run
      // never gets far enough to report a connection failure.
      expect(output).not.toMatch(/ENOTFOUND|getaddrinfo|Can't reach database/i);
    },
    150_000,
  );

  // POSITIVE CONTROL on the real binary. A guard wired to refuse unconditionally
  // would pass the test above; only this one tells the two apart. localhost:1 is
  // permitted by the guard, so execution proceeds and then fails to connect —
  // which is the proof that the guard let it through.
  it(
    "PERMITS a local target — proceeds past the guard and fails at the connection instead",
    () => {
      const { output } = runSeed({
        DATABASE_URL: "postgresql://u:p@localhost:1/db",
        ALLOW_DESTRUCTIVE_SEED: undefined,
      });
      expect(output).not.toContain("REFUSED");
      expect(output).toContain("running against");
    },
    150_000,
  );
});
