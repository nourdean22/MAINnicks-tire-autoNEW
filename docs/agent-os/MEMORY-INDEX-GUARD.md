# Memory-index guard — install proposal

**Status: written and tested, NOT installed.** The script and its canaries are in the repo; the
hook line is not. Installing it is one edit to `.claude/settings.json`, below. Until that edit
lands, `check-memory-index.mjs` is an **unwired control** — shape 1 — and this file says so rather
than implying coverage that does not exist.

## The defect

`MEMORY.md` is loaded into every session. Past a read limit (~24,400 bytes observed) it
**truncates silently**. A truncated index and a complete one render identically — a list of
memories — so entries past the cut become invisible while every session reports fine. The lost
entries are the **oldest ACTIVE ones**, at the bottom, which are exactly the accumulated
"do NOT re-propose X" directives that stop work being redone.

This is not hypothetical. The index header already records a **2026-08-19 compaction done because
"tail entries were invisible"** — it has happened once and was noticed by accident.

**Measured 2026-08-23:** 21,248 bytes = 87.1% of the limit, ~19 entries of headroom. Five of 113
pointers held 3,352 bytes — **15% of the index in 4% of its lines** — by carrying detail the
file's own header says belongs in the topic file. After compressing those five and re-indexing one
orphan: **19,541 bytes, 80.1%, 4,859 bytes of headroom.** Reproduce with `wc -c MEMORY.md`.

## Why it cannot be a repo gate

The memory directory is **machine-local** — `~/.claude/projects/<slug>/memory/` — and is in no
checkout. CI cannot see it. `lefthook` cannot see it. `pnpm agent:verify` cannot see it. A
`SessionStart` hook is the only surface that runs on the machine holding the file.

## What the guard checks

| # | Check | Failure means |
|---|---|---|
| 1 | The **INDEX-END sentinel** is the last non-empty line | The marker can no longer prove a complete read — it was removed, or entries were appended after it |
| 2 | **Headroom** — warn ≥80%, fail ≥92% | Truncation is imminent and will be silent |
| 3 | **Reachability** — every topic file is referenced by `MEMORY.md` or `settled-index.md` | A memory nothing points at is written, stored, and never recalled |

Check 3 already found one: `statenour-chat-audit-2026-07-04.md` was reachable from neither index,
and nothing had reported it.

**Exit codes: 0 clean · 1 a check failed · 2 the guard could not run.** It never exits 0 on
"I could not look" — a guard that fails open prints the same green as a healthy index, which is
the defect it guards against. Note this is deliberately *unlike* `pretool.mjs`, which fails open
by design because blocking every tool call on its own bug would be worse; here, failing open
returns the system to exactly the silent state the guard exists to end.

## Install — one edit

Add a second entry to the existing `SessionStart` array in `.claude/settings.json`:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PROJECT_DIR}\\scripts\\agent-os\\check-memory-index.mjs\" --quiet",
  "timeout": 10
}
```

`--quiet` suppresses the healthy line so a normal session start stays clean; **warnings and
failures still print.** Drop `--quiet` to see the size on every start.

> **This sentence was false when first written, and review caught it.** The code gated the 80%
> warning on `--quiet` as well, so the documented install command would have suppressed the early
> warning entirely and the operator would first have heard about capacity when the guard *failed*
> at 92% — an early-warning system that only speaks once it is too late, inside the guard written
> against exactly that. The code now matches this sentence, and a canary asserts it: `--quiet`
> must emit `WARNING` and must not emit the healthy line.
>
> Worth noting which artifact was right. The **doc** described the intended behaviour correctly;
> the **code** did not implement it. The usual failure in this repo is the reverse, and it is why
> "read the service, not the doc" is the standing advice — but the rule underneath is *measure*,
> not *prefer the code*.

**Verify the install the way this repo verifies anything** — plant a positive, do not trust that
adding the line worked:

```bash
node scripts/agent-os/check-memory-index.mjs              # expect exit 0 today
node scripts/agent-os/check-memory-index.mjs --dir /nope  # expect exit 2, "CANNOT CHECK"
node --test scripts/agent-os/memoryIndex.test.mjs         # 7 canaries, 7 pass
```

Then start a session and confirm the hook actually fired. A hook line present in a settings file
is a **pointer**, not an execution — the distinction that cost this repo an entire operating
profile that loaded in zero sessions while its parity check stayed green.

## Growing the index once installed

Past ~80%, **do not compact sentences again.** That has been spent twice (2026-08-19, 2026-08-23)
and buys weeks. Move the oldest ACTIVE entries into `settled-index.md`; that two-level split
already holds 66 files and every topic file is reachable through one index or the other. Keep each
pointer to **one line with its directive** — `do NOT re-propose X` — and let the detail live in
the topic file, which is what the index header has always said.

## What the canaries do and do not prove

`scripts/agent-os/memoryIndex.test.mjs` is fixture-only: every case builds a throwaway directory
and passes `--dir`. It proves the guard's **logic**. It cannot prove the guard ever **runs**
against the real index — that is what the hook does. A passing suite around an uninvoked guard is
shape 1, and pointing at the test as if it were coverage would be the exact substitution this
repo keeps recording.
