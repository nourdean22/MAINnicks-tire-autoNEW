# USER.md - working context for Nour (allowlisted, not a biography)

Always loaded. Only what changes how you work with him. Health, family, religion, finances, insurance,
customer data and personal contacts never go here, in commits or in PR text. Changing numbers (prices, hours,
review counts) are read from source files, never copied here. [Letters] cite sources (see the last line).

## Who

- **Nour** is the operator. At the shop the crew calls him **Nick**. GitHub `@nourdean22`. [A]
- "Moe" was an old shop-name idea (the shop was once "Moe's Euclid Tire & Auto", hence the `moeseuclid` inbox).
  Moe is not a person. [B]
- Owner-operator of **Nick's Tire & Auto**, Cleveland (Euclid Ave). Timezone America/New_York. [A][C]
- Builds **NOUR OS** (`apps/statenour`, bdnick.info) for himself. Exactly one user: him. [D]
- Shop team: Mash and Manny run operations; Zach is a hybrid tech. [A]
- Shop model: first come, first served, walk-ins 7 days, no held appointment slots. Facts: `apps/nickstire/shared/business.ts`. [C][E]

## How to work with him

- Reads on his iPhone, mid-task, often while something is broken. Both apps run as home-screen PWAs. [F]
- Output accommodation: answer first, numbered steps, at most 5 items, concrete time estimates, one next action. [G]
- Runs several agent sessions at once. Never disturb sibling sessions, branches or worktrees. [H]
- Signals: a pasted report or audit = implement and merge. "merge it" = merge after green. Docs-only PRs merge
  right away. "fix all of it and don't come back until finished" = one PR, one report. ALL CAPS = emphasis. [I]
- Ask him only for: spending money, customer-facing sends, production writes, credentials. [I]
- Cost: CI runs cost him money (one validated push per PR); no second model bill (evals stay on his Ollama plan);
  no broad disk scans without asking. [J]

## What he wants from you

- Truth over comfort. Challenge weak reasoning and novelty-chasing. No flattery, no fake positivity. [K]
- Proof, not claims. Recover context yourself ("the brain", "continue", "finish it") before asking him to repeat. [K]
- Priorities he named for this work (2026-10-11): truth, useful completion, lead generation, customer service,
  product quality, productivity, motivation, reliability, time returned to him. Not profit alone. [M]
- Shop and customer copy: direct, calm, confident, professional; no hype, slang or emojis. [A]

## Settled - do not re-ask

Weather SMS stays on. The review-flywheel idea is rejected. Reels carry "Illustrated, not filmed." instead of
loud AI labels. [L] Facts marked REFUTED in `apps/statenour/docs/OPERATOR-BIOGRAPHY.md` stay refuted. [A]

## Corrections

A newer explicit correction from Nour beats anything here. Fix this file and the source in the same PR, update
any agent memory that repeats the old fact, and never re-derive the old fact from an older summary.

Source letters [A]-[M] resolve in [USER-SOURCES.md](USER-SOURCES.md) (not auto-loaded; open when a fact is in doubt).
