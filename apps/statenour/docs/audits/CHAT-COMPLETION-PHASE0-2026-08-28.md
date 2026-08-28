# Chat Completion Build Order — Phase 0 gate + findings (2026-08-28)

Executing `docs/prompt-products/CHAT-COMPLETION-BUILD-ORDER-2026-08-28.md`. Phase 0 is a blocking
gate; this is its report, plus two operator-requested measurements and one WP3 pre-check.

---

## 1 · The gate: claim → probe → observed → verdict

| # | Claim | Probe | Observed | Verdict |
|---|---|---|---|---|
| 1 | No `ANTHROPIC_API_KEY` in any env | grep 3 env files · `railway variables --service statenour-web` | 0 local, 0 Railway | **VERIFIED** |
| 2 | Default lane Ollama Cloud `gpt-oss:120b` | env grep · `lib/ai/provider.ts:93-106` | Lane correct; **prod model is `minimax-m3`** | **PARTIALLY STALE** |
| 3 | `routeCapability` still SHADOW | `git grep "routeCapability(" -- '*.ts' '*.tsx'` minus tests | **0 live call sites** | **VERIFIED** |
| 4 | Canary unset, deep-only | Railway grep · `effort-policy.ts:179-199` | unset; `enabled && mode === "deep"` | **VERIFIED** |
| 5 | Resume 204s unless complete | read the route | `record.status !== "complete" → 204` | **VERIFIED** |
| 6 | 180s client abort is the only deadline | `use-chat-stall.ts:81` | `abortMs = 180_000`; `maxDuration = 120` documented inert | **VERIFIED** |
| 7 | Inngest live + funded | Railway grep · `lib/inngest/jobs.ts:221` | 2 keys set · serve route · `ALL_MEGA_JOBS` · `inngest@4.4.0` | **VERIFIED** |
| 8 | No `REDIS_URL` / Upstash anywhere | env grep + Railway | **`REDIS_URL` IS SET** (`redis://…@redis.railway.internal:6379`), consumers in `lib/utils/redis.ts`, `cache.ts` | **STALE** |
| 9 | Chips gone, action row exists | ran both suites | 9/9 pass — but the work is **uncommitted in a sibling's tree**, not on `origin/main` | **VERIFIED-WITH-DELTA** |
| 10 | *(unmeasured — measure it)* | prod `tool.surfaced` + serialized the exact set from one real turn | **26 tools, 8,498 chars ≈ 2,125 tok**; 4-day window n=28 turns: avg 24, p50 26, range 15–28 | **MEASURED** |

### What the deltas changed

- **#8 STALE.** Redis exists in production with live consumers. This changes nothing I built — the
  DO-NOT-ADD-REDIS directive stands and the Postgres resume path is correct — but the *reasoning*
  offered for it ("the usual Redis dependency is already designed around") was wrong about the
  facts. The directive survives; its justification does not.
- **#2 PARTIALLY STALE.** Three env files give three different models (`gpt-oss:120b`, `glm-5.1`,
  `minimax-m3`). Only Railway is real. The WP1 cost model prices status quo against `minimax-m3`.
- **#9 DELTA — the consequential one.** The per-message action row is a sibling session's
  **uncommitted** work in the primary checkout. It is not on `origin/main`. Consequence: WP2's UI
  affordance cannot land in `chat-island.tsx` / `chat-message-list.tsx` / `chat-composer.tsx`
  without colliding with files another session holds dirty (register #12). **WP2 therefore shipped
  the server capability only**; the client wiring is deliberately deferred rather than force-merged.
- **#10.** The measured number is **26 tools ≈ 2,125 tok**, not the 180 the UI advertises. The
  pruner is doing its job. Register #10's "retrieval-over-tools" proposal is **not supported by
  this data** — 26 is inside the low-tens plateau the cited work describes, so there is nothing to
  fix here. Reported rather than acted on, per the register's own instruction.

**Gate ruling:** proceeded, with the three deltas stated above and the plan adjusted for #9.

---

## 2 · Operator question A — has anything in `docs/prompt-products/` ever been executed?

**Essentially a graveyard. Adoption base rate before today: 0 of 1.**

The directory has held exactly two artifacts in its history (`git log --all -- docs/prompt-products/`):

| Artifact | Added | Consumed? |
|---|---|---|
| `signal-forge.md` | 2026-07-09 | **No.** `AUDIT/2026-08-truth.md:182` already adjudicated its product: *"Only `@nour/signal-forge` is genuinely consumer-less (3 prose references, no importer)"* |
| `CHAT-COMPLETION-BUILD-ORDER-2026-08-28.md` | 2026-08-28 (untracked) | First execution is this session |

A repo-wide grep for `prompt-products` outside the directory itself returns **zero** references —
nothing links to it, no script reads it, no doc points at it.

**What this implies:** a prompt-product is worth exactly the session that executes it. The
directory is not a queue anyone drains. If future work is going to live there, it needs a consumer
(an index entry, a checklist reference) or it will sit unread the way `signal-forge.md` did for
seven weeks. **This is not an argument against the documents' quality** — the build order this
session executed was accurate on 7 of 10 claims and its Phase 0 gate caught the three that had
drifted, which is exactly what it was designed to do.

---

## 3 · Operator question B — which of the 14 register items are live hazards?

Measured against this session's evidence. **Split: 7 live · 5 scar tissue · 2 doctrine.**

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Rebuilding what exists | **SCAR** | The 2026-08-12 incident. Phase 0 is the fix, and it worked — caught 3 stale claims. |
| 2 | Fixing symptom, shipping disease | **SCAR** | 2026-08-09 "Nick is stuck" bandage; WP2 is the disease fix. |
| 3 | Raising the timeout | **LIVE** | 180s abort ↔ token caps coupling is real and unfixed. WP2 explicitly did **not** touch it. |
| 4 | Silent degradation | **DOCTRINE** | No single incident; the five-silent-gates chain is the standing shape. |
| 5 | Dead controls | **LIVE** | The `turbo` toggle armed `providerOverride:"anthropic"` against a nonexistent key until chips were deleted. |
| 6 | Spending on own judgment | **LIVE** | Open right now — WP1 is halted on it by design. |
| 7 | $0-doctrine conflict | **LIVE** | Unresolved operator tension; named in the WP1 doc, not resolved. |
| 8 | Prompt-cache invalidation | **LIVE** | Load-bearing *today*: §5 of the WP1 model shows cache-hit rate dominates the bill 36:1. |
| 9 | Duplicate messages | **SCAR** (armed) | Fixed 2026-08-09; the hook comment carries it. WP2 re-armed the risk and answered it with a deterministic resume id. |
| 10 | Tool-schema bloat | **DOCTRINE — refuted today** | Measured 26 tools / 2,125 tok. Not present. |
| 11 | E2E snapshots | **LIVE, not mine** | `chat-states.spec.ts-snapshots/` exists; the sibling's UI change invalidates it. **My diff touches zero client components**, so it is not triggered by this work — it lands on whoever merges the UI. |
| 12 | Dirty working tree | **LIVE — fired on me** | 47 dirty files in the primary checkout; it is why WP2 shipped server-only. Worked in a clean worktree off `origin/main`. |
| 13 | Memory-layer collateral | **SCAR** (armed) | The 38-row consolidation incident. WP2 re-armed it by writing prose near `brain_memories` — answered by using `metadata` and adding explicit quarantine to both exclude lists. |
| 14 | Testing the mock | **LIVE** | `chat-composer.test.tsx` carries 4 `vi.mock` calls. WP2's answer: `chat-stream-resume.test.ts` drives the **real route handler** and parses the emitted SSE body. |

**Reading:** the register earns its length, but half its weight is history. The five SCAR items are
worth keeping — two of them (#9, #13) were *re-armed by this very session's work* and would have
been real defects without the register naming them. That is the register paying for itself.

---

## 4 · WP3 pre-check (substrate only — WP3 is NOT built)

The build order says: *"Verify this API against installed `inngest@4.4.0` before writing to it —
the older standalone `@inngest/realtime` package is archived."* Done:

| Check | Observed |
|---|---|
| Installed version | `inngest@4.4.0` (pnpm store) |
| `./realtime` subpath exported | **Yes** |
| `./react` subpath exported | **Yes** |
| Realtime surface | `channel`, `realtime`, `subscribe`, `getSubscriptionToken`, `staticSchema` |
| Standalone `@inngest/realtime` | Not installed — correctly absent |

**Verdict: the build order's WP3 substrate claim is VERIFIED.** Realtime is in-SDK, no dependency
needs adding.

*(Honesty note: my first read of the exports map used a truncated slice and I briefly concluded
`./realtime` was absent. The full check above corrects it before it reached a report — recording
this because a truncated probe producing a confident wrong answer is the exact failure shape this
document is otherwise cataloguing.)*

**WP3 is not started.** It needs a new `next_action` table (hand-applied migration), per-thread
rate limits, a daily self-follow-up cap, dedupe keys, and an operator kill switch — the build
order's own non-negotiables for an agent that can wake itself. A half-built self-scheduling agent
is worse than none, so the substrate is de-risked and the build is left whole for a session that
can finish it. Its trigger condition is also partly WP1-gated: *"a turn classified `hard`/
`frontier`"* presumes the band classifier WP1 would introduce.
