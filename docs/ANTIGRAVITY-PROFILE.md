# Antigravity Operating Profile — NOURCITY Monorepo

## Purpose
This profile defines how Antigravity should operate inside `nourdean22/MAINnicks-tire-autoNEW` on this machine.

In addition to repo safety rules, Antigravity should maintain awareness of the CEO laptop environment so it can recommend better workflows, automation opportunities, tooling improvements, architectural refinements, and operational efficiencies over time.

This profile is intended to be both a safety framework and a continuous-improvement framework. Antigravity should not limit itself to only completing the requested task when it can clearly identify adjacent improvements that would increase reliability, maintainability, security, developer productivity, performance, observability, documentation quality, testing coverage, deployment safety, or business value.

When Antigravity identifies improvements outside the immediate scope of a task, it should:
- Document the opportunity.
- Explain the expected benefit.
- Estimate implementation complexity and risk.
- Recommend whether it should be completed immediately, deferred, or tracked separately.
- Implement low-risk improvements when they are clearly beneficial and do not conflict with owner instructions.
- Request approval before making significant architectural, infrastructure, security, workflow, or business-process changes.

Antigravity should actively look for:
- Technical debt reduction opportunities.
- Missing tests and verification gaps.
- Documentation deficiencies.
- Repeated manual workflows that can be automated.
- Performance bottlenecks.
- Security hardening opportunities.
- Reliability improvements.
- Monitoring and observability gaps.
- Developer experience improvements.
- Build and CI/CD optimizations.
- Data integrity risks.
- User experience improvements.
- AI-assisted workflow enhancements.
- Cost-saving opportunities across infrastructure and tooling.

The goal is not merely to preserve the current system but to continuously improve it while maintaining safety, transparency, and owner control.

---

## 0. Environment Discovery & Workflow Optimization
When explicitly authorized by the owner, Antigravity may inventory the local development environment to understand available capabilities and suggest improvements.

Potential discovery areas include:
- Installed development tools
- MCP servers and configurations
- Local AI models and Ollama setup
- IDE extensions and integrations
- Git tooling
- Node, pnpm, Python, Docker, and database tooling
- Automation platforms
- CLI utilities
- Internal scripts and helper tools
- Existing workflow documentation
- CI/CD integrations
- Monitoring and logging tools
- Cloud infrastructure tooling
- Security and compliance tooling
- Backup and recovery tooling
- Browser automation tooling
- Local databases and development services

### Goals
- Identify redundant tools
- Detect missing dependencies
- Recommend workflow improvements
- Suggest automation opportunities
- Surface underused capabilities already installed
- Improve verification speed and reliability
- Reduce repetitive manual work
- Create reusable operating procedures
- Improve onboarding documentation
- Improve deployment safety
- Improve testing coverage
- Improve observability and diagnostics
- Improve local development performance
- Standardize workflows across projects
- Reduce operational risk

### Safety Requirements
- Never modify system settings without approval.
- Never install software without approval.
- Never remove software without approval.
- Never expose secrets, credentials, tokens, or private data.
- Never commit machine-specific configuration into the repository unless explicitly requested.
- Present findings and recommendations before making changes.
- Clearly distinguish observations from assumptions.
- Preserve owner privacy and security at all times.

### Suggested Outputs from Environment Reviews
- Installed Tools
- Available MCP Servers
- Available AI Models
- Workflow Opportunities
- Automation Opportunities
- Missing Dependencies
- Performance Opportunities
- Security Opportunities
- Documentation Opportunities
- Recommended Improvements
- Owner Decisions Needed

---

## 1. Mandatory Repo Rules
Before editing anything:
- Read root [AGENTS.md](file:///C:/Users/nourd/NOURCITY/AGENTS.md).
- Read the app-specific file:
  - `apps/statenour/AGENTS.md` before touching Statenour.
  - `apps/nickstire/AGENTS.md` before touching Nick’s Tire.
- Confirm current branch and worktree.
- Create or use a named branch only:
  - `statenour/<task>`
  - `nickstire/<task>`
  - `docs/<task>`
  - `chore/<task>`
- Never work directly on `main`.
- Never push directly to `main`.
- Never merge without explicit owner approval.
- Never force-push shared history.
- Never use `--no-verify`.
- Never use `git add -A`.
- Stage only exact intended file paths.
- Keep Statenour and Nick’s Tire changes separated unless owner explicitly asks for a cross-app PR.
- Review existing work before introducing new patterns.
- Prefer improving existing systems over creating duplicate systems.
- Maintain consistency with established project conventions unless there is a compelling reason to improve them.

---

## 2. Worktree Standard
For non-trivial work, use a fresh worktree:
```bash
git worktree add .worktrees/<task-name> -b <branch-name> origin/main
```

Before and after pushing, check for rider commits:
```bash
git log origin/<branch>..HEAD
git status --short
git diff --name-only
```

If another agent added commits to the same branch, disclose them in the PR body. Do not rewrite them away.

### Additional Worktree Guidance
- Keep worktrees isolated to a single objective whenever practical.
- Remove stale worktrees after completion.
- Verify dependency installation before running verification commands.
- Avoid mixing unrelated experiments into active task branches.

---

## 3. Fresh Worktree Install Rule
Fresh worktrees must install package dependencies with the workspace suffix:
```bash
pnpm install --frozen-lockfile --filter "<app>..."
```
Do not use a bare filter that skips workspace dependencies.

Examples:
- `pnpm install --frozen-lockfile --filter "@statenour/web..."`
- `pnpm install --frozen-lockfile --filter "nicks-tire-auto..."`

### Additional Guidance
- Prefer reproducible installs.
- Investigate lockfile drift before modifying dependencies.
- Document dependency additions when they materially affect the project.

---

## 4. Verification Gates

### Statenour
Run from `apps/statenour` unless a root script is explicitly used:
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm verify:hard
```
Also acceptable from repo root when already established:
```bash
pnpm test:stn
pnpm stn verify:hard
```
Do not pipe Vitest to tail if it hides the exit code. Always read the final summary.

**Additional expectations:**
- Review warnings, not just failures.
- Investigate flaky tests rather than repeatedly rerunning them.
- Prefer fixing root causes over suppressing checks.

### Nick’s Tire
Run from `apps/nickstire`:
```bash
pnpm run verify
```
For full Nick’s Tire Vitest on Windows, use serial/fork-safe mode:
```bash
pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true
```
For targeted tests, use package filters only when the command is known to work.

**Additional expectations:**
- Verify customer-facing workflows when affected.
- Validate business-critical automations after changes.
- Confirm reporting and operational metrics remain accurate.

---

## 5. Timezone Rules
Nick’s Tire operates in Cleveland/Eastern time.

For customer operations, SMS windows, daily shop metrics, and “today” calculations:
- Do not rely on database/server default timezone.
- Avoid fragile `CURDATE()` logic unless explicitly converted.
- Use Cleveland/Eastern semantics, normally `America/New_York`.
- In tests, mock time explicitly with Vitest fake timers when sending windows or daily boundaries matter.
- Document timezone assumptions when implementing date-sensitive features.
- Consider daylight-saving transitions during design and testing.

---

## 6. SMS / VAPI / External Automation Rules
Never trigger live external side effects during development or tests.
- Do not send live SMS.
- Do not trigger live VAPI updates.
- Do not publish live Google Business Profile posts.
- Do not call live Meta write APIs.
- Do not mutate production data.
- Do not drop tables.

Any automation PR must state:
- `no live SMS sent`
- `no live GBP post published`
- `no live VAPI update executed`
- `no production DB mutation performed`
- `no secrets exposed`

### Additional Expectations
- Use mocks, fixtures, or test environments whenever possible.
- Clearly identify external dependencies.
- Document rollback procedures for automation changes.
- Verify failure handling and retry behavior.

---

## 7. Database / Prisma Rules
Statenour schema and migrations require extreme caution.
- Do not run destructive Prisma commands against production.
- Do not use `prisma db push` as a production migration strategy unless explicitly approved.
- If a Prisma model/table is retired, provide:
  - Formal migration or explicit owner decision
  - Data-preservation answer
  - Rollback plan
  - Deployment notes
  - Verification that production will not silently lose needed data

### Additional Database Expectations
- Prefer reversible migrations.
- Validate assumptions against actual schema state.
- Consider indexing, performance, and query efficiency.
- Protect historical and operational business data.

---

## 8. Secret / Env Rules
Never commit:
- `.env`
- `.env.local`
- API keys
- DB URLs
- Tokens
- Credentials
- Antigravity logs containing secrets
- Local scratch files
- `.system_generated`
- Worktree artifacts

Before PR, check:
```bash
git status --short
git diff --name-only
git diff --cached --name-only
```

Search changed files for:
- `DATABASE_URL`
- `NEON`
- `OPENAI`
- `GEMINI`
- `VAPI`
- `TWILIO`
- `META`
- `STRIPE`
- `SECRET`
- `TOKEN`
- `KEY=`
- `PRIVATE`

### Additional Expectations
- Minimize secret exposure in logs.
- Use least-privilege principles where applicable.
- Flag suspicious credential handling patterns.

---

## 9. PII Guard
For Nick’s Tire work:
- Run `lint:pii` when touching customer-facing, CRM, SMS, admin, bridge, or marketing systems.
- Confirm staged-file scanning is actually scanning files, not silently passing.
- Public shop phone/address may be allowlisted only intentionally.
- Customer names, phones, emails, addresses, invoice IDs, and service histories require minimization.

### Additional Expectations
- Prefer anonymized test data.
- Avoid unnecessary duplication of customer information.
- Limit exposure of sensitive operational records.

---

## 10. PR Body Requirements
Every PR must include:
- `## Summary`
- `## Files Changed`
- `## Verification`
- `## Safety Notes`
- `## Risks`
- `## Owner Decisions Needed`

For cross-app or migration work, also include:
- `## Scope Inventory`
- `## Database Safety`
- `## Rollback Plan`
- `## Secret Safety`

Recommended additions when applicable:
- `## Improvement Opportunities`
- `## Technical Debt Addressed`
- `## Follow-Up Recommendations`
- `## Monitoring Considerations`

---

## 11. Final Report Format
At the end of any task, return:
```markdown
Branch:
Commit SHA:
Changed files:
Checks run:
PR link:
Intentional exclusions:
Risks:
Owner decisions needed:
Recommendation:
Future improvement opportunities:
```

Where applicable, Antigravity should also identify:
- Additional improvements discovered.
- Deferred recommendations.
- Potential automation opportunities.
- Areas requiring future review.

---

## 12. Local MCP Configuration
Detected local MCP config reportedly includes:
- `cloudrun`
- `ollama-reviewer`

Before relying on these:
- Confirm the config file is present.
- Confirm required credentials exist.
- Confirm local Ollama daemon is running if using local review.
- Do not assume these services are available in CI or other machines.
- Do not put local MCP assumptions into repo code.

### Additional MCP Guidance
- Prefer documented and reproducible MCP workflows.
- Clearly identify MCP-dependent recommendations.
- Verify availability before incorporating MCP-dependent processes into task execution.
- Treat local MCP capabilities as optional enhancements rather than guaranteed infrastructure.
