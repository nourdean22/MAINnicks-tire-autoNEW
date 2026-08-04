# Agent OS — the repository's agent control plane

**Started 2026-08-04.** One canonical policy → thin vendor adapters → executable checks.

A markdown file can *influence* an agent; it cannot *guarantee* behavior. So this repo separates
the two: `AGENTS.md` carries judgment, and code carries enforcement.

## Layers, and what each one can actually promise

| Layer | Artifact | Promise |
|---|---|---|
| 1 · Canonical policy | [`AGENTS.md`](../../AGENTS.md) + `apps/*/AGENTS.md` | The single place a rule is written. Read by Claude, Codex, Copilot, Cursor, Gemini and humans. |
| 2 · Vendor adapters | `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `apps/*/CLAUDE.md` | Route their agent to layer 1. Thin and pointer-only **by construction** — line-capped by the parity check, so a second policy cannot quietly fork into existence. |
| 3 · Executable parity | `scripts/agent-os/check-adapters.mjs` | Adapters exist, point at their `AGENTS.md`, stay under cap; retired claims (`.husky/pre-*`, `push-main.sh`, "no CODEOWNERS", live `apps/voice`) stay deleted. |
| 4 · Local enforcement | `.claude/settings.json` hooks + `scripts/agent-os/` | Deny unsafe tool calls before they run; gate completion claims. Claude-only — see "Honest limits". |
| 5 · CI | [`.github/workflows/agent-policy.yml`](../../.github/workflows/agent-policy.yml) | Runs layers 3–4's checks on every PR, for every author, including humans. |

## One command

```bash
pnpm agent:verify
```

`scripts/agent-os/verify.mjs` runs adapter parity, then **auto-discovers** every
`scripts/agent-os/*.test.mjs` and runs it under Node's built-in test runner.

That discovery is deliberate. Editing anything under `.github/workflows/**` flips `test.yml`'s
path filter and escalates CI from a ~1-minute security job to a full turbo sweep plus every
nickstire and statenour validator (~50 minutes). Adding a new guard should cost a file, not an
hour of CI — so new checks are dropped in as `*.test.mjs` and the workflow never changes.

## Adding a rule

1. Write it in `AGENTS.md` (repo-wide) or `apps/<app>/AGENTS.md` (app-specific). **Not** in an adapter.
2. If it must be *guaranteed* rather than *followed*, add the check:
   - a structural invariant → extend `check-adapters.mjs`
   - a forbidden command or file-write → add a rule to `config/agent-os/policy.json`. Every rule
     MUST carry `why`, `fix`, ≥1 `denyExamples`, ≥1 `allowExamples` — `policy.test.mjs` fails
     otherwise, so an untested or undocumented rule cannot ship.
   - anything else → add `scripts/agent-os/<name>.test.mjs`
3. Run `pnpm agent:verify`.

## Layer 4 — what is actually wired (2026-08-04)

`.claude/settings.json` hooks, all engine logic in `scripts/agent-os/`:

- **PreToolUse** (`pretool.mjs`, matcher `Bash|PowerShell|Write|Edit|NotebookEdit`) evaluates
  `config/agent-os/policy.json` (v2) and blocks with exit 2: pushes to `main` in any spelling,
  pushes with an **implicit destination** (bare `git push`, `origin`-only, `HEAD`/`@` refspec —
  they resolve to the current branch, which may be main), force-push (incl. bundled `-uf` and
  `+refspec`), `git add -A`/`--all`/`.`, `--no-verify`, the destructive-restore family
  (`reset --hard`, `checkout -- <path>`, worktree-writing `git restore`, `git clean -d/-f/-x`),
  `stash pop/apply/branch`, `git worktree remove` AND `rm -r`/`Remove-Item -Recurse` aimed at a
  worktree, the destructive-Prisma family (`--accept-data-loss`, `--force-reset`,
  `migrate reset`), destructive SQL *with a DB client on the line*, `pnpm install` inside a
  junctioned worktree, and writes to `.env*` files. Git rules expand a `__GIT__` macro so global
  options (`git -C <path> push …`) cannot slip between `git` and the verb — that exact shape
  defeated every git rule in the first draft (red-team, 2026-08-04, 22 verified bypasses → 0).
- **Stop** (`stop-check.mjs`) blocks ending a turn with uncommitted work while ON `main` —
  one precise invariant, nothing else. A Stop hook that blocks routine turns trains the
  operator to disable it; widen only behind a canary.
- **Failure posture is asymmetric on purpose:** a matched rule fails CLOSED; a bug in the hook
  itself fails OPEN with a stderr warning. Bricking every tool call is worse than missing one
  check, and Claude Code fails open on hook crash/timeout anyway — pretending otherwise is theatre.
- **Mention ≠ execution — handled, narrowly.** Quoted `-m/--message/--title/--body` arguments are
  replaced with `<ARG>` before matching (a commit message *discussing* `git push origin main` is
  data), and a single **unchained** read-only command (`rg`, `grep`, `git log/show/diff/grep`,
  `cat`…) skips command rules entirely — any chaining character disarms the skip, so
  `rg x && git push origin main` still blocks. Everything else is still matched as text: an
  `echo` quoting a forbidden string gets blocked (safe direction — `sh -c "…"` quoting IS
  execution); put test payloads in files and pipe them. Discovered live when this layer's own
  e2e test blocked itself.
- **There is deliberately no bypass env var.** Changing a rule means editing `policy.json` in a
  PR where the diff is reviewable.

## Writing a check that actually catches something

The parity script's `forbidLine()` has a comment worth repeating: a whole-file text search for a
retired term flags **the sentence that retires it**. Guarding "`push-main.sh` must not appear"
deletes the note explaining why nobody should use it — and the next agent reinvents it.

So: forbid the *prescriptive* form, not the mention. `.husky/pre-` (a claim about where the hook
lives) is always wrong; the words "`.husky/` is retired" are always right. Where the distinction
can't be encoded structurally, an explicit "correction marker" exemption is used — narrow, and
documented at the call site.

Corollary, learned here: **the first version of a check that goes green may just be mis-scoped.**
This one's first run flagged two real stale lines and one false positive. Read what a failing
check is actually pointing at before "fixing" the file.

## Honest limits

- **This repo has no branch protection or rulesets.** `gh pr merge --squash` succeeds over a red
  check. CI here is advisory; red means stop by convention only. Making checks *required* is a
  repo-settings change only the operator can make (Settings → Branches → protect `main` →
  require `Agent policy` + `CI`).
- **Layer 4 is Claude-only.** Claude Code hooks do not constrain Codex, Cursor, Copilot or a
  human. Anything that must hold for *every* author belongs in layer 5 (CI) or in repo/production
  permissions — never only in a hook or a markdown rule.
- **`@modelcontextprotocol/server-filesystem` has no read-only mode.** Its write tools are always
  exposed; the version is pinned in `scripts/start-codebase-mcp.ps1`. Restrict at the client or
  with a Docker `ro` mount — see [`docs/codebase-memory-mcp.md`](../codebase-memory-mcp.md).

## Known gaps (deliberate, not forgotten)

- `pnpm-lock.yaml` still has an empty `apps/voice: {}` importer entry. Inert; removing it churns
  the lockfile and escalates CI, so it is left for a dependency-touching PR.
- `ANTIGRAVITY_MASTER_PLAN.md` (root, 2026-07-09) is a completed one-shot plan still sitting at
  the repo root where agents load it as if it were policy. Archive candidate.
- `docs/00-current-truth/architecture.md` still diagrams `apps/voice` as a live ring.
- The Antigravity layer (`.antigravityrules`, `docs/ANTIGRAVITY-*.md`, ~680 lines) now points at
  `AGENTS.md` as canonical but has not been slimmed to a true thin adapter.
