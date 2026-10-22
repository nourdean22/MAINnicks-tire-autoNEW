---
name: deploy-not-live
description: "Use when a PR is merged but the change is not visible on nickstire.org or bdnick.info, or someone says Railway is stuck, a build died or failed, the deploy is not live yet, or asks whether a merged PR is live. Read-only triage: which commit each app runs, why it is behind, and the one next step for Nour. Not for: running or fixing a deploy, a full production audit (production-health-report), an unmerged or stranded branch (stranded-branch-rescue), database scripts (prod-db-guard), or pre-commit checks (statenour-verify, nickstire-verify)."
---

# deploy-not-live

Find out why a merged change is not live and say it in plain words. This skill reads and reports. It never changes a deploy.
The usual cause is not a bug in the PR: it is the platform, a dead build, or a deploy-config fix that waits for Nour.

## Steps

1. **Read what each app says it is running.** No login is needed:
   - nickstire: `curl.exe -s https://nickstire.org/api/version`, field `build.commit`.
   - statenour: `curl.exe -s https://bdnick.info/api/version`, field `data.build.commit` (this one is wrapped in `data`).
   - A failed GET, or `status` of `unknown`, is UNKNOWN. Never fill it in from memory or from the last merge.
2. **Compare with the merge.** In PowerShell first clear the token, as `AGENTS.md` says: `[Environment]::SetEnvironmentVariable('GITHUB_TOKEN', $null, 'Process')`.
   Then `gh pr view <number> --json mergedAt,mergeCommit,files`, `git fetch origin main`, and
   `git merge-base --is-ancestor <merge sha> <running sha>`. Exit 0: the running build contains it. Exit 1: it does not.
   Any other exit means a bad sha or a missing fetch: UNKNOWN. A commit that is included is "running", not "working":
   say whether the behaviour itself was seen.
3. **Did a deploy start at all?** `gh api "repos/nourdean22/MAINnicks-tire-autoNEW/deployments?per_page=5"` lists deploy records with a sha and a time.
   If Railway is logged in and the folder is linked, `railway deployment list --limit 5 -s <service>` adds each deployment's status
   (services: `MAINnicks-tire-auto`, `statenour-web`). If it says not linked, report that; do not link anything.
   A newer record in the list while the old commit still runs usually means that deploy has not finished: INFERENCE until the status says so.
4. **Pick ONE cause class and label it FACT, STRONG INFERENCE or UNKNOWN:**
   - **Platform outage:** `https://status.railway.com` shows an open incident and neither app has a new record since it began.
   - **Build died:** the newest deployment has a status other than SUCCESS. Find the stage with
     `railway logs --build --lines 200 <deployment id> -s <service>` (always pass `--lines`; without it the command streams forever).
     Quote the one error line, never the log. Out of memory is the section below; a type error or a lockfile error is a code problem for the PR author.
   - **Login expired:** the Railway command line says unauthorized. Report it and stop using it. Steps 1 and 2 need no login and still stand.
   - **Health check red:** the deploy built but never served; the old commit is still running and `https://nickstire.org/api/health` or the deployment status says why.
   - **Not expected to rebuild:** the PR touched only files outside that service's `watchPatterns` in `.railway/railway.ts` (a statenour-only merge does not rebuild nickstire).
     That file is the recorded config; whether it is applied live is UNKNOWN until checked. Say "check", not "fine".
5. **Write the status block** (below). Answer first, plain words, five lines, short SHAs, UTC times.

## Out of memory in the build

- **Recognise it:** the build log ends with `JavaScript heap out of memory` and `Mark-Compact` lines, inside the TypeScript step of `next build`,
  while CI on the same code is green.
- **What the repo's fix looked like (PR 3223):** the build command in `apps/statenour/Dockerfile` carries `NODE_OPTIONS=--max-old-space-size=4096`.
  It sits on the command, not in a Railway variable, because a Dockerfile build sees only build arguments (CLAIM, from the comment in
  `apps/statenour/tests/repo/dockerfile-build-heap.test.ts`). The running server keeps the default.
- **Why it waits:** a Dockerfile edit is a deploy-config change. `AGENTS.md` > Protected operations needs Nour's explicit go for that specific change, every time.
  A general "go ahead" or "full auth" is not that go. So the next step for Nour is "approve this one PR", asked the moment the build dies, not hours later.
- **Verify after the merge:** read `/api/version` once. When `commit` equals the merge commit, it is running. On 2026-10-22 that took about 50 minutes
  from merge (10:42Z) to the new process (11:35Z); one observation, not a promise.

## Status block

```
merged <short sha> at <time>Z (PR <number>)
running <short sha> on <app>, read at <time>Z
cause: <class> (FACT | STRONG INFERENCE | UNKNOWN)
next for Nour (under 2 minutes): <one action, for example "approve PR 3223" or "run railway login">
record: merged, NOT LIVE at <time>Z, receipt owed
```

When the running commit includes the merge, replace the last line with "running commit includes the merge at <time>Z; behaviour receipt owed".

## Never

- Redeploy, restart, roll back or remove a deployment, write a Railway variable, or run `railway config apply`. Name the command for Nour instead.
- Edit the Dockerfile or any deploy config without Nour's explicit go for that specific change.
- Call a change live because the PR merged or CI is green. The running commit decides.
- Loop, poll or schedule checks. Look once, say when to look again.
- Paste a build log, an environment value or a token. Railway's notice to revoke variables is Nour's call, not a task here.
- Work around an expired login. Database reads are `prod-db-guard`, not this skill.
