# Hotfix Runbook — When Something Is Broken NOW

## If local repo is clean and trustworthy

```bash
cd nickstire-fresh
git pull origin seo-schema-fixes
# Make minimal fix
pnpm run build                    # Verify
git add <changed-files>
git commit -m "hotfix: <what broke>"
git push origin seo-schema-fixes  # Railway auto-deploys
```

## If local repo might be corrupted

```bash
git clone https://github.com/nourdean22/MAINnicks-tire-autoNEW.git hotfix-temp
cd hotfix-temp
git checkout seo-schema-fixes
pnpm install
# Make minimal fix
pnpm run build
git push origin seo-schema-fixes
# After verified: delete hotfix-temp
```

## Hotfix Rules

1. Fix ONE thing. Don't combine hotfixes with features.
2. Test the build locally before pushing.
3. Watch Railway logs for 5 minutes after deploy.
4. If the hotfix makes things worse, revert immediately (see ROLLBACK_RUNBOOK.md).

## Emergency Contacts / Systems

- Railway dashboard: railway.app
- GitHub repo: github.com/nourdean22/MAINnicks-tire-autoNEW
- DNS: Cloudflare (nickstire.org)
- Domain registrar: check Cloudflare DNS settings
