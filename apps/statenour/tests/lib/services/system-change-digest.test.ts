import { describe, it, expect } from "vitest";
import {
  parseLatestReconciliation,
  readDeployIdentity,
  assembleDigest,
  buildSystemChangeDigest,
  type DigestParts,
} from "@/lib/services/system-change-digest";

const RECON = `# Reconciliation · statenour-os

**Last verified:** 2026-06-09 ...big header...

> ## 2026-06-09 · useful function wave · F1-F5
>
> Some description of the wave.
> - **\`a38f2d98\`** — add Claude session importer
> - **\`dc5696c1\`** — re-scope roadmap
> - Verify: typecheck 0 · vitest 220 files green · build green
>
> ## 2026-06-06 · earlier wave
> - older stuff \`deadbeef\`
`;

describe("parseLatestReconciliation", () => {
  const e = parseLatestReconciliation(RECON);
  it("extracts the latest date + title", () => {
    expect(e?.date).toBe("2026-06-09");
    expect(e?.title?.toLowerCase()).toContain("function wave");
  });
  it("extracts ship SHAs from the latest block only (not the older entry)", () => {
    expect(e?.ships).toContain("a38f2d98");
    expect(e?.ships).toContain("dc5696c1");
    expect(e?.ships).not.toContain("deadbeef"); // belongs to the older entry
  });
  it("extracts the verify gate line", () => {
    expect(e?.verifyGate).toContain("typecheck 0");
  });
  it("returns null when no entry present", () => {
    expect(parseLatestReconciliation("no blockquote here")).toBeNull();
  });

  it("stops at a non-blockquote line — does not harvest SHAs past the entry (review fix)", () => {
    const doc = [
      "# Reconciliation",
      "",
      "> ## 2026-06-09 · latest",
      "> - **`a38f2d98`** shipped",
      "",
      "Some non-blockquote prose mentioning deadbeef and cafe1234.",
    ].join("\n");
    const e = parseLatestReconciliation(doc);
    expect(e?.ships).toContain("a38f2d98");
    expect(e?.ships).not.toContain("deadbeef"); // outside the blockquote
    expect(e?.ships).not.toContain("cafe1234");
  });
});

describe("readDeployIdentity (honest, never hallucinates)", () => {
  it("reports Railway production when RAILWAY env is present", () => {
    const d = readDeployIdentity({ RAILWAY_GIT_COMMIT_SHA: "c4716a90abc", RAILWAY_GIT_BRANCH: "main", RAILWAY_ENVIRONMENT_NAME: "production" });
    expect(d.status).toBe("production");
    expect(d.source).toBe("railway");
    expect(d.sha).toBe("c4716a90abc");
  });
  it("reports unknown (not deployed) when no deploy env is present", () => {
    const d = readDeployIdentity({});
    expect(d.status).toBe("unknown");
    expect(d.source).toBe("none");
    expect(d.note.toLowerCase()).toContain("verify");
  });
  it("does not treat Vercel 'dev' placeholder as a deploy", () => {
    expect(readDeployIdentity({ VERCEL_GIT_COMMIT_SHA: "dev" }).status).toBe("unknown");
  });
});

describe("assembleDigest", () => {
  const base: DigestParts = {
    reconciliation: { date: "2026-06-09", title: "x", ships: ["a38f2d98"], verifyGate: "typecheck 0" },
    staleCriticalInKeyDocs: 0,
    staleWarnInKeyDocs: 0,
    keyDocsUnreadable: [],
    evals: { total: 23, passed: 22, failed: 0, manual: 1 },
    runbooksActive: 8,
    runbooksOldestVerified: "2026-06-09",
    deployment: { sha: "x", branch: "main", env: "production", source: "railway", status: "production", note: "ok" },
    now: "2026-06-09T00:00:00.000Z",
  };

  it("is all-clear when green", () => {
    const d = assembleDigest(base);
    expect(d.risks).toEqual([]);
    expect(d.nextOwnerDecision.toLowerCase()).toContain("nothing pending");
  });

  it("surfaces a critical stale-doc finding as the top next decision", () => {
    const d = assembleDigest({ ...base, staleCriticalInKeyDocs: 1 });
    expect(d.risks.join(" ")).toContain("critical");
    expect(d.nextOwnerDecision.toLowerCase()).toContain("stale-doc");
  });

  it("surfaces failing evals", () => {
    const d = assembleDigest({ ...base, evals: { total: 23, passed: 20, failed: 3, manual: 0 } });
    expect(d.nextOwnerDecision).toContain("3");
  });

  it("flags an unknown deploy without asserting one", () => {
    const d = assembleDigest({ ...base, deployment: { sha: null, branch: null, env: null, source: "none", status: "unknown", note: "n" } });
    expect(d.risks.join(" ").toLowerCase()).toContain("unverified");
    expect(d.nextOwnerDecision.toLowerCase()).toContain("verify");
  });

  // 2026-07-30 sweep · an unreadable key doc contributes ZERO stale
  // findings, so without this the digest reported "truth + checks are
  // green" over a doc it never actually read.
  it("never claims green when a key truth doc could not be read", () => {
    const d = assembleDigest({ ...base, keyDocsUnreadable: ["docs/CURRENT-TRUTH.md"] });
    expect(d.risks.join(" ")).toContain("UNREADABLE");
    expect(d.nextOwnerDecision.toLowerCase()).not.toContain("nothing pending");
    expect(d.truth.keyDocsUnreadable).toEqual(["docs/CURRENT-TRUTH.md"]);
  });
});

describe("buildSystemChangeDigest (injected deps — no fs/DB)", () => {
  it("assembles a digest from injected docs + env deterministically", async () => {
    const docs: Record<string, string> = {
      "docs/RECONCILIATION.md": RECON,
      "docs/CURRENT-TRUTH.md": "Production deploys from main to Railway, bdnick.info. Vercel is retired.",
      "AGENTS.md": "agents",
      "docs/runbooks/index.md": "runbooks",
    };
    const d = await buildSystemChangeDigest({
      loadDoc: (rel) => docs[rel] ?? null,
      env: { RAILWAY_GIT_COMMIT_SHA: "abc1234", RAILWAY_ENVIRONMENT_NAME: "production" },
      now: () => "2026-06-09T00:00:00.000Z",
    });
    expect(d.latestWave?.date).toBe("2026-06-09");
    expect(d.deployment.status).toBe("production");
    expect(d.truth.evals.total).toBeGreaterThan(0);
    expect(d.truth.staleCriticalInKeyDocs).toBe(0); // the CURRENT-TRUTH fixture is clean
    expect(d.generatedAt).toBe("2026-06-09T00:00:00.000Z");
  });
});
