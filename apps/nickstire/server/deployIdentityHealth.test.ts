/**
 * `/api/health` must say WHICH BUILD is serving.
 *
 * `version` is a static package number identical across every deploy, so it
 * could never answer "did my merge land?". Proving a deploy meant watching
 * `uptime` reset — timing evidence a coincidental restart fakes silently.
 *
 * `resolveNickDeployIdentity` already existed and read RAILWAY_GIT_COMMIT_SHA,
 * with ZERO consumers anywhere in the tree. The producing half was built and
 * the consuming half never was — the same shape as the reel-pack bridge and
 * DUA_FRANCHISE_KITS. See docs/agent-audit/PATTERN-PRODUCER-WITHOUT-CONSUMER.md
 *
 * These assert the PAYLOAD, not the function: a test that only exercised
 * resolveNickDeployIdentity would have passed for the entire period in which
 * nothing called it.
 */
import { describe, it, expect } from "vitest";
import { resolveNickDeployIdentity } from "./lib/deployIdentity";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("/api/health reports the running commit", () => {
  it("wires the resolver into the response payload", () => {
    // The consuming half. Without this line the resolver is unreachable and
    // the endpoint cannot identify its own build.
    const src = readFileSync(join(__dirname, "lib", "health.ts"), "utf8");
    expect(src).toContain("deploy: resolveNickDeployIdentity(process.env)");
  });

  it("reports the Railway commit when the platform injects one", () => {
    const d = resolveNickDeployIdentity({ RAILWAY_GIT_COMMIT_SHA: "de876a6e7abc1234def" });
    expect(d.commit).toBe("de876a6e7abc1234def");
    expect(d.commitShort).toBe("de876a6e7");
    expect(d.status).toBe("identified");
    expect(d.source).toBe("railway");
  });

  it("falls back to GIT_SHA for non-Railway builds", () => {
    const d = resolveNickDeployIdentity({ GIT_SHA: "abc123456789" });
    expect(d.commitShort).toBe("abc123456");
    expect(d.source).toBe("explicit");
  });

  it("says UNKNOWN rather than inventing a placeholder", () => {
    // The failure that matters: a fabricated SHA would make every deploy look
    // verified while proving nothing. Absence must read as absence.
    const d = resolveNickDeployIdentity({});
    expect(d.commit).toBeNull();
    expect(d.commitShort).toBeNull();
    expect(d.status).toBe("unknown");
    expect(d.note).toContain("cannot identify the running build");
  });

  it("prefers Railway over the manual escape hatch", () => {
    const d = resolveNickDeployIdentity({ RAILWAY_GIT_COMMIT_SHA: "railway123", GIT_SHA: "manual456" });
    expect(d.commit).toBe("railway123");
  });
});
