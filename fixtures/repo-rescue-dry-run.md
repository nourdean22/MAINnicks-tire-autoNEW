# repo-rescue dry-run fixture

This branch exists only so `scripts/agent-os/repo-rescue.test.mjs` has a REAL, unlanded branch to
dry-run against: one commit on an old main, no pull request, never to be opened as one or merged.

If this branch is deleted, that test skips with the ref to recreate. Recreate it from an old main
commit with a single commit that adds this file. Do not open a PR for it and do not delete it as
stale: branch sweeps list it as QUARANTINE on purpose.
