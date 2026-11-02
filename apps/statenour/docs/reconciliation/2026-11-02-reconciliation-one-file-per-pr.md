> ## 2026-11-02 · Reconciliation entries move to one file per PR (job 2026-11-02-platform-forever-fixes) · 1 ship
>
> Every PR used to insert its entry at line 3 of `docs/RECONCILIATION.md`, so any two open PRs conflicted there: PRs 3500, 3504, 3506, 3507 and 3508 went DIRTY against each other five times on 2026-11-01/02 and each was re-merged by hand. A `merge=union` attribute would not help: GitHub merges pull requests on its own servers and does not run `.gitattributes` merge drivers (community discussion 9288, open and unanswered since 2021).
>
> - **One file per PR.** New entries go to `docs/reconciliation/<YYYY-MM-DD>-<slug>.md`, same blockquote format as before. `RECONCILIATION.md` keeps every entry up to 2026-11-02 unchanged, under a header that points here.
> - **Reader.** `node scripts/agent-os/reconciliation-render.mjs` prints the entries newest first (`--list`, `--tail <n>`); a misnamed file or a header whose date differs from the file name fails it (exit 1, named). Same pattern as `docs/agent-os/ledger/` + `ledger-render.mjs`.
> - **Change digest.** `lib/services/system-change-digest.ts` reads the newest file here as the latest wave, and falls back to the top of `RECONCILIATION.md` when the folder is empty or missing. `e2e-statenour.yml` re-includes this folder like the other runtime-read docs.
>
> **Flagged · NOT fixed**
> - The `**Last verified:**` stamp in `RECONCILIATION.md` and `AGENTS.md`'s `**Last refreshed:**` still pair up (`check-stale-docs.ts`); a PR that moves both still edits one shared line. Move them once per wave, not per PR.
