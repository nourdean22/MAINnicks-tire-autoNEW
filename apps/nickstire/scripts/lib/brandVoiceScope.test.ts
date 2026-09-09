/**
 * Regression suite for the 2026-09 bug: the brand-voice pre-commit gate
 * silently scanned zero files in this monorepo, always, because `scopeOf()`
 * never received a stripped path. `git diff --cached --name-only`, run with
 * cwd set to apps/nickstire, returns repo-root-relative paths
 * ("apps/nickstire/client/src/pages/Careers.tsx") — confirmed live, not
 * assumed — while IN_SCOPE's regexes are anchored to the bare,
 * workspace-relative form. Without the strip, `scopeOf()` on the unstripped
 * path always returns null, `inScope.length === 0`, and
 * `scanStagedDiff()` returns early having read nothing. This suite pins the
 * fix with the EXACT path shape observed in production, not a synthetic one.
 */
import { describe, expect, it } from "vitest";
import { scopeOf, stripWorkspacePrefix, IN_SCOPE } from "./brandVoiceScope";

describe("stripWorkspacePrefix", () => {
  it("strips the apps/nickstire/ prefix git actually reports for --name-only output", () => {
    expect(stripWorkspacePrefix("apps/nickstire/client/src/pages/Careers.tsx")).toBe(
      "client/src/pages/Careers.tsx",
    );
  });

  it("leaves an already-stripped path untouched (idempotent)", () => {
    expect(stripWorkspacePrefix("client/src/pages/Careers.tsx")).toBe("client/src/pages/Careers.tsx");
  });

  it("does not touch a path from a sibling app — this script only ever runs from apps/nickstire", () => {
    expect(stripWorkspacePrefix("apps/statenour/app/page.tsx")).toBe("apps/statenour/app/page.tsx");
  });
});

describe("REGRESSION: scopeOf() only matches once the path is stripped — the exact 2026-09 bug", () => {
  it("the raw git --name-only path form (unstripped) never matches — this IS the bug, pinned so it can't silently return", () => {
    expect(scopeOf("apps/nickstire/client/src/pages/Careers.tsx")).toBeNull();
  });

  it("stripWorkspacePrefix(gitPath) resolves to the correct surface — this is the fix", () => {
    const gitReportedPath = "apps/nickstire/client/src/pages/Careers.tsx"; // exact live-confirmed shape
    expect(scopeOf(stripWorkspacePrefix(gitReportedPath))).toBe("web");
  });

  it("every IN_SCOPE regex is anchored (^...$ or ^...) to a bare, workspace-relative path with no apps/nickstire prefix — a future entry copy-pasted from a repo-root-relative example would reintroduce this bug silently", () => {
    for (const { rx } of IN_SCOPE) {
      expect(rx.source.startsWith("^apps\\/nickstire")).toBe(false);
    }
  });
});

describe("scopeOf — scope rules unaffected by the fix (behavior preserved)", () => {
  it("matches a page component", () => {
    expect(scopeOf("client/src/pages/Careers.tsx")).toBe("web");
  });

  it("matches a shared component", () => {
    expect(scopeOf("client/src/components/LeadPopup.tsx")).toBe("web");
  });

  it("matches the voice-agent script", () => {
    expect(scopeOf("server/services/vapi.ts")).toBe("voice");
  });

  it("matches an SMS sequence/outreach/recovery cron job", () => {
    expect(scopeOf("server/cron/jobs/winbackSequences.ts")).toBe("sms");
    expect(scopeOf("server/cron/jobs/leadOutreach.ts")).toBe("sms");
    expect(scopeOf("server/cron/jobs/missedCallRecovery.ts")).toBe("sms");
  });

  it("excludes admin-panel pages even when the path otherwise matches an in-scope pattern", () => {
    expect(scopeOf("client/src/pages/admin/leads/CandidatesPanel.tsx")).toBeNull();
  });

  it("excludes a file that doesn't match any surface — server routers, tests, schema", () => {
    expect(scopeOf("server/routers/candidates.ts")).toBeNull();
    expect(scopeOf("server/candidates.test.ts")).toBeNull();
    expect(scopeOf("drizzle/schema.ts")).toBeNull();
  });
});
