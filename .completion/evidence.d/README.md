# Per-PR completion evidence

`apps/nickstire/scripts/dod-compiler.mjs` works out requirements from your diff (for example
`capability-ledger-updated` or `cron-fail-closed`). Put the evidence for THIS diff in a new file here.
Name it after your branch (`chore/evidence-fragments` -> `chore-evidence-fragments.json`):

```json
{
  "evidence": {
    "cron-fail-closed": { "ref": "server/cron/x.test.ts: a non-operator caller is refused (3 arms)" },
    "operator-walkthrough": { "deferred": "operator-pending: needs a live admin session" }
  }
}
```

Each entry needs a non-empty string `ref` (what proves it) or non-empty string `deferred` reason. Arrays, objects, booleans and blank strings are invalid evidence.

- **A new file per PR never conflicts.** The old single manifest, `.completion/evidence.json`, conflicted
  on every pair of concurrent PRs, because freshness meant "this branch rewrote key X".
- **Freshness is by content.** An entry counts only if its exact value appears nowhere at the merge-base:
  not in any file here and not in the legacy manifest, under any key. The following all read STALE:
  - an earlier PR's fragment left untouched,
  - a renamed or copied fragment,
  - a superseded entry pasted back.
- **An invalid JSON file here fails `--enforce`.** The compiler does not skip it.
- **The legacy manifest is still read**, so rewriting its entry still passes. Prefer a fragment.

Proposed later step (not done yet): fold the merged fragments and the `-superseded-` keys of
`evidence.json` into a dated archive. This only saves space. Freshness does not depend on it.
