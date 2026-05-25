# Code-Craft Review Lens

**Skill port:** B10 · vibe-code-auditor + uncle-bob-craft + clean-code
**Applies to:** PR reviews · companion to feature-dev:code-reviewer's correctness focus · code-aesthetic + craft + maintainability lens.
**Authored:** 2026-05-26.

## Why this doc exists

Correctness review (feature-dev:code-reviewer) catches bugs, security issues, type errors. CRAFT review catches the next class of problems · code that compiles, runs, passes tests · but bleeds maintainability cost every time someone reads it.

This rubric is the second pass · after correctness, before merge.

## The 5 craft dimensions (each 0-20 · total 100)

### 1 · Naming clarity (0-20)

Variable, function, file names that don't lie.

| Score | Criteria |
|---|---|
| 20 | Every name reflects what it actually does · no abbreviation that needs decoding · no `data` / `info` / `manager` god-nouns |
| 15 | Mostly clear · 1-2 ambiguous names |
| 10 | Mixed · operator has to read 3 lines to understand what `processItem()` does |
| 5 | Cryptic names · `doThing()` · `tmpVar` · `handler2()` |
| 0 | Names actively mislead · `getUser()` returns a list · `isReady` returns a string |

### 2 · Function shape (0-20)

Functions that do one thing, at one level of abstraction.

| Score | Criteria |
|---|---|
| 20 | Average function <20 lines · obvious purpose · 0-3 args · returns one type |
| 15 | Most functions clear · 1-2 outliers |
| 10 | Mixed · some 80-line functions doing 4 things |
| 5 | Multiple 200-line god-functions |
| 0 | Functions that mutate global state · take 8 args · return any |

### 3 · Indirection budget (0-20)

Indirection layers are a tax. Each one adds cognitive cost. Too many = "follow 5 calls to find the actual logic."

| Score | Criteria |
|---|---|
| 20 | Reader can trace from entry to implementation in ≤3 jumps |
| 15 | 4-5 jumps for complex flows · acceptable |
| 10 | 6-8 jumps · operator gets lost |
| 5 | 10+ jumps · the abstraction added value somewhere but I can't find it |
| 0 | Indirection for indirection's sake · factories of factories · strategies of strategies |

### 4 · Comment quality (0-20)

Comments that explain WHY, not WHAT. (The code already says what.)

| Score | Criteria |
|---|---|
| 20 | Every non-obvious decision has a comment · the comment explains TRADE-OFFS or HISTORICAL CONTEXT or NON-OBVIOUS GOTCHAS |
| 15 | Most non-obvious decisions documented · 1-2 unexplained |
| 10 | Some comments · most just restate the code |
| 5 | No comments OR comments that lie (out-of-date) |
| 0 | Stale comments contradicting current code |

Nickstire codebase OFTEN scores 18-20 here per memory's commit-message discipline. The comments-as-archaeology pattern is a craft strength · MEMORY.md references like "wave-181.60 (May 18) | SMS routing default flipped Twilio→shop" let future agents recover context fast.

### 5 · Test coupling (0-20)

Tests that fail when intended behavior breaks · NOT when implementation changes.

| Score | Criteria |
|---|---|
| 20 | Tests describe behavior · refactoring doesn't break tests · adding features adds tests |
| 15 | Mostly behavioral · 1-2 implementation-coupled tests |
| 10 | Mixed · refactoring breaks 20-30% of tests for spurious reasons |
| 5 | Tests are implementation snapshots · any change cascades broken tests |
| 0 | No tests OR tests that never fail OR tests that test the mocking framework |

Per audit's #167 finding (every money-path file has zero tests) · this is a known gap. Tests aren't the only thing; tests of the RIGHT thing are.

## Total score → action

| Total | Bucket | Action |
|---|---|---|
| 85-100 | **Exemplary** | Merge · use as a reference for future code |
| 70-84 | **Ship** | Merge as-is OR with 1-2 small comments |
| 50-69 | **Iterate** | Request changes · address top-2 craft issues · re-review |
| 30-49 | **Refactor** | Block merge · refactor in this PR OR open follow-up · don't ship without addressing |
| 0-29 | **Reject** | Block · the bones are wrong · re-architect before merging |

## Anti-patterns called out

### "Clean for clean's sake"

Refactoring code that works · for "cleanliness" · with no test coverage · while another bug ships. The craft pass is for NEW code OR refactor PRs · not a continuous yak-shave.

### "Don't comment the code"

The "code should be self-documenting" cliché. Code documents WHAT · comments document WHY. They're complementary, not redundant.

### "100% test coverage" obsession

Coverage is a metric, not a goal. A function with 100% coverage that asserts nothing is worse than 60% coverage with behavioral assertions. Track ASSERTIONS PER FUNCTION, not coverage.

### "Naming bikeshed"

Spending 30 minutes debating `isUserAdmin` vs `userIsAdmin`. Pick one, ship. Style preferences should be in an enforced linter, not in PR discussions.

## How to apply

Code-craft review is a 5-minute pass · NOT a deep audit. Open the PR, scan the diff for the 5 dimensions, write a comment with:
1. Total score
2. Highest-impact craft issue (just one · don't list 10)
3. Specific suggestion (with code example)
4. Acknowledge what's done well (don't make it adversarial)

Example:

```
Craft score: 72/100 · Ship with one change.

Issue · the new `processPaymentResult()` function takes 6 args
and returns 4 different shapes depending on input. Single-
responsibility violation.

Suggestion · split into `validatePaymentResult()` (returns
ValidationResult) and `applyPaymentResult()` (returns ApplyResult).
Or use a discriminated-union return type.

Strong points · the audit-log row pattern (Wave V autonomous-tier
discipline) · zod validation on every input · matches existing
codebase conventions.
```

## Skill-port lineage

B10 from the audit's Round 2. Pairs with:
- feature-dev:code-reviewer (correctness review · runs first)
- Wave X · A4 tool-builder patterns (design discipline · prevents craft issues at design time)
- Wave T · postmortem template (when craft issues cause incidents, document the structural fix)
- Wave Q + T + U · linters (catch the lowest-level naming/style at pre-commit · craft review catches structural)

Future · automate the craft review · run the model with this rubric on every PR · post comment with the score · operator + dev decide whether to act.
