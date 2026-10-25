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
- The shop's how-we-operate doc: `apps/nickstire/docs/SHOP-SOUL.md`; read it before shop-facing work.
- Shop team: Mash and Manny run operations; Zach is a hybrid tech. [A]
- Shop model: first come, first served, walk-ins 7 days, no held appointment slots. Facts: `apps/nickstire/shared/business.ts`. [C][E]
- Shop data meanings: a ShopDriver counter invoice is a closed job (a sale), and its payment status means nothing (payment is taken
  on a separate register); app-made online tire orders do track payment. An estimate with no matching invoice most likely means the
  customer walked (declined work) but stays an inference unless the counter recorded the no. Key follow-ups to invoices, not bookings
  (bookings are rare). [N]

## How to work with him

- Reads on his iPhone, mid-task, often while something is broken. Both apps run as home-screen PWAs. [F]
- Output accommodation: answer first, numbered steps, at most 5 items, concrete time estimates, one next action. [G]
- Runs several agent sessions at once. Never disturb sibling sessions, branches or worktrees. [H]
- Signals: a pasted report or audit = implement and merge. "merge it" = merge after green. Docs-only PRs merge
  right away. "fix all of it and don't come back until finished" = one PR, one report. ALL CAPS = emphasis. [I]
- Ask him only for: spending money, customer-facing sends, production writes, credentials. [I]
- 2026-10-25, his words: "Why do you have to come to me for one little step?" Inside an order he gave, dispatch, pulls,
  merges on green (policy and skill edits he asked for included) and cleanup are done, then reported; never a question. [O]
- Cost: CI runs cost him money (one validated push per PR); no second model bill (evals stay on his Ollama plan);
  no broad disk scans without asking. [J]

## What he wants from you

- Truth over comfort. Challenge weak reasoning and novelty-chasing. No flattery, no fake positivity. [K]
- Proof, not claims. Recover context yourself ("the brain", "continue", "finish it") before asking him to repeat. [K]
- Priorities he named for this work (2026-10-11): truth, useful completion, lead generation, customer service,
  product quality, productivity, motivation, reliability, time returned to him. Not profit alone. [M]
- Shop and customer copy: direct, calm, confident, professional; no hype, slang or emojis. [A]

## Settled - do not re-ask

Weather SMS stays on. The review-flywheel idea is rejected. Reels carry no AI label or disclosure clause (2026-10-11;
Rule 1 still bars AI footage framed as real). [L] Facts marked REFUTED in `apps/statenour/docs/OPERATOR-BIOGRAPHY.md` stay refuted. [A]

## Corrections

A newer explicit correction from Nour beats anything here. Fix this file and the source in the same PR, update
any agent memory that repeats the old fact, and never re-derive the old fact from an older summary.

Source letters [A]-[O] resolve in [USER-SOURCES.md](USER-SOURCES.md) (not auto-loaded; open when a fact is in doubt).
