
# NourOS code-intelligence governance — current truth

Date: 2026-09-28 ET
Status: BUILT + LOCALLY VERIFIED on the follow-up branch above Toolsmith + Owner Panel exception consolidation. Not merged, deployed, or scheduled-live at this receipt.

## Decision

Graphify remains the existing developer-facing code graph. This slice does not create a runtime graph database, duplicate Graphify, or bulk-ingest the graph into BrainMemory.

The missing layer was governance: a successful graph refresh did not leave one compact artifact proving what commit the graph described, how far that commit was from current code, whether community labeling actually ran, or what structural drift changed.

## New compact receipt

scripts/graphify-governance-receipt.mjs writes:

graphify-out/GRAPH_RECEIPT.json

The receipt is intentionally separate from Graphify's existing manifest.json, which is a large internal per-file AST/hash cache.

Receipt fields include:

- schema version + generated-at timestamp;
- Graphify version when the CLI exposes one;
- sync run status;
- community-label provenance (LLM, hub-derived, skipped, or another explicit caller value);
- GRAPH_REPORT.md source commit;
- report SHA-256 + mtime;
- node, edge, community, shown-community, and thin-community counts;
- extraction/inference mix when the report exposes it;
- relationship of the graph source commit to:
  - current HEAD;
  - the locally observed origin/main remote-tracking ref;
- commit distance when the graph source is an ancestor;
- state: current, ok, stale, diverged, or unknown;
- delta in nodes / edges / communities from the newest older dated snapshot with a different source commit;
- existing importer-death necropsy docket path + candidate count when present;
- explicit caveats that counts are drift signals, community ids are unstable, origin/main is only locally observed, and Graphify is not canonical product memory.

The script never fetches remotes, edits source, installs anything, or writes BrainMemory.

## Scheduled sync integration

The existing scripts/graphify-obsidian-sync.ps1 remains the canonical local refresh workflow.

After the graph + Obsidian digest have successfully been generated, it now performs two non-fatal governance steps:

1. If at least two dated Graphify snapshots exist, run the existing propose-only scripts/graphify-necropsy.mjs.
2. Write the compact governance receipt with the actual labelStatus from the same sync.

A failure in necropsy or receipt generation is logged loudly but does not erase or invalidate graph/vault artifacts already produced.

No duplicate drift detector was introduced; the existing necropsy remains canonical for importer-death events.

## Session-start integration

scripts/graphify-session-context.ps1 already selected the fresher report and compared its embedded source commit with current HEAD.

It now also looks for GRAPH_RECEIPT.json beside that exact selected report.

Safety rule:

- receipt source commit == selected report source commit AND receipt SHA-256 == selected report SHA-256 -> receipt may be summarized;
- missing receipt -> say governance receipt is unavailable;
- commit or report-hash mismatch -> print RECEIPT MISMATCH and ignore it;
- malformed receipt -> print receipt-unreadable and keep the graph summary.

The receipt never suppresses the existing graph briefing.

When valid, session start can show:

- label provenance;
- sync run status;
- local origin/main freshness state + commit distance;
- architecture shape delta;
- importer-death candidate count.

## Real local proof on 2026-09-28

Running the receipt against the currently tracked graph produced:

- source commit: 9c4f30f4;
- 63,099 nodes;
- 115,045 edges;
- 3,401 communities;
- graph was 313 commits behind the current local branch HEAD;
- graph was 308 commits behind locally observed origin/main.

That is the important outcome: an old graph can no longer look authoritative merely because a report file exists or a sync task once succeeded.

## Verification

- node --check scripts/graphify-governance-receipt.mjs green.
- governance script self-test green.
- existing graphify-necropsy.mjs --self-test green.
- PowerShell parser accepts both graphify-obsidian-sync.ps1 and graphify-session-context.ps1.
- repo contract tests: 4/4 green; the session-start contract now pins both source-commit and report-SHA-256 matching.
- live session-context execution exits 0 and prints the governed freshness line.
- git diff --check green.

## Not claimed

- The scheduled Windows task has not run this new code yet.
- No fresh Graphify rebuild was performed in this slice; the point of the local proof was to expose the existing graph's staleness honestly.
- No CI artifact publication is added yet.
- No automatic issue creation occurs from necropsy findings.
- No graph finding receives authority merely because it appears in Graphify.

Production/operator proof remains pending until this commit is eventually pushed, merged, the local scheduled sync runs it, and a real GRAPH_RECEIPT.json from that governed run is inspected.
