# Rollback Runbook — Under 5 Minutes

## Quick Rollback (revert last commit)

```bash
git log --oneline -10          # Find last good commit
git revert HEAD                # Create a revert commit (safe, preserves history)
git push origin main
```
Railway auto-deploys. Site recovers in ~2 minutes.

## Hard Rollback (multiple commits) — DESTRUCTIVE

> ⚠️ **`git push --force` rewrites remote history.** Anyone else with a
> clone will need to re-clone or rebase. Only use when revert isn't
> sufficient (e.g., commits leaked secrets that must be erased).
> Prefer `git revert` for almost every case.

```bash
git log --oneline -10                    # Find the good commit hash
git reset --hard <good-commit-hash>      # WARNING: destroys local changes
git push origin main --force             # WARNING: rewrites remote history
```

## After Rollback

1. Verify site loads at nickstire.org
2. Verify admin login works at nickstire.org/admin
3. Check Railway logs for errors (first 5 minutes)
4. Document what broke before re-attempting the change
5. If the issue was a bad migration, check Railway DB console

## Railway-Specific

- Railway auto-deploys on push to `main`
- Deploy takes ~2-3 minutes
- Check deploy status at railway.app dashboard
- If deploy fails, Railway keeps the previous version running
