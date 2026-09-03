# MASTER BUILD PROMPT — bdnick.info Agent OS modernization
Paste into a capable coding agent (OpenCode / Codex CLI / Claude Code) at the repo root.
Written 2026-09-03 against verified ground truth. **Everything asserted here was checked; anything
uncertain is marked VERIFY.**

---

You are working in `C:\Users\nourd\NOURCITY`, a pnpm monorepo. Your scope is **`apps/statenour`
only** (the personal agent at bdnick.info). Read `AGENTS.md` and
`C:\Users\nourd\NOURCITY\CLAUDE-OPERATING-PROFILE.md` before your first edit.

## HARD CONSTRAINTS — violating any of these fails the task
1. **NEVER push to `main`.** Named branches only. Open a PR.
2. **Never `git add -A`.** Stage explicit paths. **Never `--no-verify`.**
3. **A sibling Claude session may be editing `apps/nickstire/**`.** Do not touch that app. Run
   `git status` before you start; if nickstire files are dirty, leave them alone.
4. **`prod-db-guard`: every worktree binds the PRODUCTION `DATABASE_URL`.** A "local" script hits
   prod. A `--dry-run` flag is not a guard until you prove by non-executing inspection that it
   returns before any write.
5. **iOS standalone PWA silently suppresses `window.confirm/alert/prompt`** — they return as if
   cancelled, with no error. Every confirmation must be in-DOM. Never introduce a native dialog.
6. **Bash cwd resets to `C:\` between calls on this machine.** Use absolute paths. **Never edit JSON
   with `sed`** — use `node -e` with absolute paths. *(This exact mistake corrupted the root
   `package.json` during the research pass.)*
7. **`echo $?` after a pipe reads the LAST command's status**, not the one you care about. Redirect
   to a file and check the real exit code.
8. **Fresh worktree:** run `pnpm --filter "./packages/*" build` before any typecheck, or you get
   phantom `Cannot find module '@statenour/lenses'` errors.

## VERIFIED GROUND TRUTH — do not re-derive, but DO re-verify before depending on it
- **Next.js is `^16.2.11`** (not 15). AI SDK is **`ai@6.0.275`** after a 2026-09-03 bump;
  `@ai-sdk/react@^3.0.278` pins exactly that. **v7.0.91 is stable but NOT yet adopted.**
- **181 chat tools; `NICK_TOOL_BUDGET` default 24** (`lib/ai/chat-mode.ts:545`) — 13% exposure/turn.
- `pruneTools()` is a **6-tier cascade**; tier 4 is **~40 hand-written regexes**; tier 5 (semantic)
  **silently no-ops when `isToolEmbeddingCacheWarm()` is false**.
- `searchTools`/`invokeTool` exist (`lib/ai/tools/meta.ts:472,598`), force-added in
  `prepare-tools.ts:128`, **fail-closed to read-safe tools**.
- `recordToolInvocation()` writes via `$executeRaw` upsert (`lib/ai/tool-telemetry.ts:90`) — execution
  telemetry is GOOD. **Selection telemetry does not exist. That is the gap.**
- Inngest: **25 functions, 101 `step.run` sites, max 11 steps of a 1,000 ceiling.** The real limit is
  the **32 MiB total run state**, not step count.
- People-search does BM25 via **core Postgres `ts_rank_cd`** — **NOT the `pg_search` extension**, so
  Neon's 2026-09-21 `pg_search` removal does **not** affect this repo. Verified.
- **Host: Intel Arc 140V iGPU, no CUDA, 15.72 GB non-upgradeable RAM, ~15 GB free disk, WSL installed
  with ZERO distros.** No local agent-brain model is possible. Do not propose one.
- **Neon free-tier PITR window is 6 HOURS.**

---

## PHASE 0 — Instrument before you change anything (do not skip)

**0.1 Baseline.** Run and record: `pnpm --filter "./packages/*" build`, then in `apps/statenour`:
`pnpm typecheck:raw`, `pnpm test`, `pnpm lint`. Capture real exit codes to files. **If anything is
already failing, report it and STOP** — do not build on a red baseline.

**0.2 Tool-selection telemetry.** New Prisma model:
```prisma
model ToolGateDecision {
  id            String   @id @default(cuid())
  turnId        String
  conversationId String?
  toolName      String
  verdict       String   // ALLOWED | DENIED | NOT_FOUND | BUDGETED_OUT
  reason        String?
  tier          Int?     // 1..6, which cascade tier selected it
  rank          Int?     // semantic rank when applicable
  score         Float?
  createdAt     DateTime @default(now())
  @@index([turnId])
  @@index([toolName, verdict])
  @@index([createdAt])
  @@map("tool_gate_decisions")
}

model ToolSelectionTurn {
  id                  String   @id @default(cuid())
  turnId              String   @unique
  candidateCount      Int
  selectedCount       Int
  budget              Int
  budgetTruncated     Boolean
  embeddingCacheWarm  Boolean
  searchToolsFired    Boolean  @default(false)
  invokeToolFired     Boolean  @default(false)
  invokedToolName     String?
  searchToolsQuery    String?
  createdAt           DateTime @default(now())
  @@index([createdAt])
  @@index([searchToolsFired])
  @@map("tool_selection_turns")
}
```
Emit from `pruneTools()` and `prepare-tools.ts`. **Follow `statenour-migration` skill — migrations are
hand-applied and one wrong flag silently drops pgvector data.**

**Acceptance:** a chat turn produces exactly one `ToolSelectionTurn` and N `ToolGateDecision` rows;
`budgetTruncated` is true iff candidates > budget; `embeddingCacheWarm` reflects the real cache state.
**Write a test that asserts a cold cache produces `embeddingCacheWarm: false` rather than silently
selecting fewer tools.**

**0.3 `/system/tool-reachability` panel.** Top `searchTools` queries (the model reporting a pruner
miss — **highest-signal event in the system**), pruner misses joined to the tier that *should* have
caught them, cold-cache rate, budget-truncation rate.
⚠ **Every metric needs three visual states: value, empty, and a visually loud `unavailable`.**
The /brain audit found "a failed read rendering as a confident zero" **ten times** — copy
`judgment-quality-panel.tsx` / `contradiction-resolution-panel.tsx`, which already do it right.

---

## PHASE 1 — Disaster recovery (HIGHEST SEVERITY)
**1.1** Inngest cron: nightly `pg_dump` → object storage, 30-day retention.
**1.2** **Monthly automated restore drill into a Neon branch** (copy-on-write, near-free — which is
what makes drilling cheap enough to actually do). Verify at four levels: file exists → integrity →
schema restores → **app connects and business logic works**. Alert on failure.
**1.3** Pre-migration guard: take a Neon branch as an explicit rollback point before every
hand-applied migration.

**Acceptance:** a deliberately corrupted dump must FAIL the drill loudly. *A backup that has never
been restored has an unknown success rate.*

---

## PHASE 2 — Determinism + cost safety
**2.1** Audit all **101 `step.run` sites** for side effects *outside* steps — LLM calls, Prisma
writes, `Date.now()`, `Math.random()`, `crypto.randomUUID()`. Inngest **re-enters** code between step
boundaries. Report every finding before fixing. *(Track 7: highest ROI hour available.)*
**2.2** Idempotency: unique index on `(conversationId, turnId, toolName, argsHash)` storing the prior
response; a retried call returns the recorded result. *(There was a real `task_events` 17 ms
double-write — same class.)*
**2.3** **Cost kill switch**: per-run token ceiling + per-run tool-call ceiling + per-day budget.
Breach → hard stop with a typed error, not a silent truncation. **Per-entity caps, not shared pools.**
**2.4** **Egress allowlist** for every URL-fetching tool. This is the SSRF control and there is none today.

---

## PHASE 3 — Artifacts with visual validation
**3.1** Typst (Apache-2.0, single Rust binary, **native PNG/SVG export — no browser, no LibreOffice**)
as the primary PDF/report target. `docx`/PptxGenJS/openpyxl for editable handoff.
**3.2** **Two-gate validation, cheap before expensive:**
- **Gate 1 — deterministic geometry, no model, always runs:** text bbox vs container (overflow),
  pairwise rect intersection (overlap), rect vs page (out-of-bounds), image aspect (distortion),
  WCAG contrast, font-fallback events (tofu).
- **Gate 2 — vision critique on survivors only.** Render ≥150 DPI. Demand **structured JSON, not
  prose**. **Bias the prompt toward finding problems** — "does this look good?" returns "yes" almost
  always. **Cap at 3 rounds and require monotonic improvement**; if violation count doesn't drop, stop
  and escalate. **Repair the source, never the pixels.**

**Acceptance:** a deliberately overflowing title must be caught by **Gate 1** (no model call), and the
repair must edit the Typst source and re-render.

---

## PHASE 4 — Memory trust (largest security gap)
Add to `BrainMemory` **and `MemoryEdge`** (an edge is itself a claim): `trustTier`
(SYSTEM_VERIFIED | USER_STATED | USER_APPROVED | AGENT_INFERRED | TOOL_OUTPUT | WEB_RETRIEVED |
THIRD_PARTY_AGENT), `sourceUri` (**non-null required below USER_STATED**), `ingestionActor`,
`writeApprovalState`, `quarantineFlag`, **`sourceTraceId` → `AgentTrace.id`** (highest-leverage single
addition — lets you cascade-quarantine everything a compromised trace produced), `corroborationCount`,
`validFrom`/`validTo` (bi-temporal: **close the window, never delete**).

**Rules, enforced in code not prompt:**
- Web / third-party MCP / other-agent content → **`PENDING_REVIEW` or `SYSTEM_QUARANTINED`, never
  `AUTO_APPROVED`**, regardless of summarizer confidence.
- **No row may promote itself by repetition.** Corroboration requires a *different* `ingestionActor`
  AND a different `sourceUri` class. *(Repetition-as-verification is exactly the MINJA/eTAMP attack.)*
- **Trust tier filters BEFORE vector ranking.** A `WEB_RETRIEVED` row must never out-rank a
  `USER_STATED` row on similarity alone — that ranking exploit is how PoisonedRAG hits 90% with 5 docs.
- Only SYSTEM_VERIFIED/USER_STATED/USER_APPROVED may inform **tool-call arguments for state-changing
  actions**. Lower tiers appear only as labeled advisory context.

---

## PHASE 5 — Evals that gate
**5.1** Calibrate the existing judges: **Cohen's κ against 50–100 hand labels + a position-swap
control**. *A judge that agrees with itself is not a judge that is right* — published production
judges show >0.95 test-retest reliability alongside >0.10 position bias.
**5.2** CI gate: deterministic assertions (Zod output validity, tool-call success, cost/latency
ceilings) **block the merge**; judge scores stay **advisory**.
**5.3** Fault injection: 5xx, truncated responses, malformed tool-call JSON at the HTTP layer; kill a
worker mid-`step.run` and verify **no side effect double-fired**. *(AgentChaos: pass@1 drops up to
50pp, and **your implementation, not the model, determines resilience**.)*

---

## PHASE 6 — Browser, layered (only after 0–5)
`L0 deterministic API → L1 committed Playwright script → L2 bundled `npx playwright mcp
--isolated --allowed-origins=<domains>` (a11y tree) → L3 vision (last resort) → L4 human`.
**L2 is a COMPILER, not a runtime:** every successful exploration must terminate in a committed L1
script. Use Playwright 1.62's bundled MCP + recorder + healer — **do not add `@playwright/mcp`
separately**, it ships in the package already depended on.
**Never build L5 OS-level computer use** — open weights score 47.5% on OSWorld.
Credentials: `storage_state` JSON from a **human-run** login, mounted read-only. **The LLM never
touches a credential in any modality — and disable vision whenever secrets are on screen.**

---

## STOP AND ASK before any of these
- Applying a Prisma migration to production
- Any `git push` to `main`, or force-push anywhere
- Deleting or overwriting a worktree, branch, or backup
- Adding a paid dependency or a new hosted service
- Anything outward-facing: sending, posting, publishing, purchasing
- Touching `apps/nickstire/**` while the sibling session is active

## DEFINITION OF DONE per phase
Baseline green → change made → `pnpm --filter "./packages/*" build && pnpm typecheck:raw && pnpm test
&& pnpm lint` all pass with **real** exit codes captured → new tests cover the new behavior **and its
failure mode** → PR with: branch, SHA, files touched, checks run with output, explicit exclusions, and
anything you could not verify.

**Report honestly.** If a phase is blocked, finish every other phase in full and say exactly what you
left out and why. Do not report completion for partial work. If you find a defect in your own diff,
say so plainly and fix it — four consecutive hostile passes on this repo found real defects in work
already called done.
