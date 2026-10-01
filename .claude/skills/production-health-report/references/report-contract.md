# Production health report contract

## 1. Executive reality
Summarize what is healthy, degraded, broken, or uncertain with the highest business impact first.

## 2. Evidence snapshot
Record inspection time, production URLs/services, deployed revisions, origin/main revision, connector coverage, and unavailable sources.

## 3. Service health
For each material service show deployment state, runtime/restarts, errors, dependencies, and notable resource or database signals.

## 4. Capability reality ledger
Classify important features as LIVE + VERIFIED, LIVE BUT UNVERIFIED, BUILT + WIRED, BUILT-UNWIRED, BROKEN/DEGRADED, DUPLICATE/CONFLICTING, or MISSING. Cite concrete evidence.

## 5. Job and data-path health
Cover schedulers, cron, workers, queues, integrations, database writes, and downstream receipts.

## 6. Code/deploy/CI drift
Identify production-vs-main skew, stale PRs/worktrees, failing tests, or docs that contradict reality.

## 7. Action queue
Use Restore now, Harden next, Clean later. Include how to verify each action after execution.

## 8. What would change the conclusion
List missing logs, production access, metrics, or receipts that prevent stronger claims.
