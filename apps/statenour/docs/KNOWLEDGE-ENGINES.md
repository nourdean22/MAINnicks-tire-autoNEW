# Statenour Knowledge Engines — Current Contract

> Current architecture contract for Obsidian, NotebookLM, Graphify, BrainMemory, and bounded self-learning. Live code and `docs/CURRENT-TRUTH.md` win if this document drifts.

## One canonical memory

**Statenour `BrainMemory` in Neon is the canonical online memory used by the production application at `bdnick.info`.**

The surrounding systems have distinct jobs:

| Surface | Canonical role | Runs where | May write BrainMemory? | Runtime dependency? |
|---|---|---|---|---|
| BrainMemory | Durable online memory, retrieval, provenance, confidence, embeddings | Railway / Neon | Native source | Yes |
| Obsidian | Local capture surface, durable Markdown mirror, human editing and export | Nour's Windows machine / vault | Yes, through governed ingest | No; app must degrade safely |
| NotebookLM | External grounded research and source synthesis | Google + authenticated local MCP sidecar | Not directly; output must pass an ingestion gate | No; optional bridge |
| Graphify | Developer-facing code architecture snapshot | Developer workstation / repository artifact | No | No |
| Auto-learn | Bounded outcome-learning after verified application events | Statenour server | Yes, with explicit source/version | Yes for supported events, never for core task completion success |

These are not four competing brains. They are a hub-and-spoke system around BrainMemory.

## Obsidian contract

Obsidian is a **local knowledge bridge**, not a cloud engine running inside Railway.

The intended flow is:

```text
Local Markdown capture
  -> doctor validates structure and metadata
  -> ingest classifies, deduplicates, embeds, and writes BrainMemory
  -> Statenour remains canonical online memory
  -> export mirrors approved structured records back into Markdown
  -> conflict protection preserves local edits
```

Operational truth:

- `lastRunAt` records a real engine command, not a heartbeat.
- `daemonHeartbeatAt` says whether the local watch process is recently alive.
- `lastSuccessfulSyncAt` advances only when doctor, ingest, export, and final doctor all succeed.
- A heartbeat must not convert a failed or stale pipeline into a green status.
- Heartbeats stay local and do not write Neon every 30 seconds.
- Partial failures must exit non-zero and remain visible in the cloud status snapshot.

The web application may show the last known local status, but it cannot directly access a Windows vault from Railway.

## NotebookLM contract

NotebookLM is a **grounded-research bridge**, not canonical memory and not a guaranteed always-on production dependency.

The current bridge requires:

1. A locally authenticated NotebookLM MCP server.
2. A transport proxy exposing an SSE endpoint.
3. `NOTEBOOKLM_MCP_URL` configured on Railway.
4. Explicit notebook IDs such as `NOTEBOOKLM_ID_INTEL`.
5. A valid Google session in the sidecar.

Health has layers:

- **Transport connected:** the MCP sidecar accepted a connection.
- **Notebook configured:** the requested alias maps to a real notebook ID.
- **Action succeeded:** the requested NotebookLM tool completed.
- **Knowledge accepted:** any output intended for Statenour passed provenance, confidence, deduplication, and approval rules.

A connected transport does not prove the Google session or every notebook action is healthy. Missing notebook aliases must fail explicitly; fake placeholder IDs are prohibited.

### Recommended production evolution

The localtunnel flow is suitable for experimentation, not world-class reliability. The preferred future architecture is a private, authenticated sidecar reachable through Tailscale Funnel, Cloudflare Tunnel with Access/service tokens, or another controlled transport with:

- stable endpoint identity;
- authentication between Railway and sidecar;
- health and session-expiry signals;
- bounded retries and timeouts;
- request size limits;
- audit receipts;
- no public unauthenticated tunnel.

## Graphify contract

Graphify is currently a **developer code-graph snapshot**. Its surfaces are `graphify-out/GRAPH_REPORT.md` (the versioned map, the only one in git) plus two gitignored HTML views regenerated on every sync:

| File | Size | Use |
|---|---|---|
| `graph-communities.html` | ~2 MB | One node per community. The browsable one — ~26 s load, ~92 ms redraw. |
| `graph.html` | ~43 MB | Every node. Renders correctly but is **not interactive** — ~344 s load, ~2,205 ms redraw. Requires `GRAPHIFY_VIZ_NODE_LIMIT` above the node count or graphify skips it. |

Both load vis-network from a CDN, so neither renders offline.

It is useful for:

- repository orientation;
- identifying hubs, communities, and cross-package relationships;
- giving coding agents a map before deeper source inspection;
- finding architectural drift and unexpected coupling.

It is not currently:

- a live bdnick.info runtime service;
- a replacement for source inspection;
- canonical product memory;
- guaranteed to describe the current commit.

It **is** now automatically refreshed: a daily scheduled task runs `scripts/graphify-obsidian-sync.ps1`, which rebuilds the graph and regenerates both the HTML views and the Obsidian community digests. That refresh builds from the working tree of the local checkout — which may sit on a detached HEAD — so freshness of the *run* still does not guarantee it describes `origin/main`. A future governed Graphify pipeline should record:

- reachable source commit SHA;
- generated-at timestamp;
- Graphify version and configuration;
- file/node/edge counts;
- excluded paths;
- generation result;
- drift from the previous snapshot;
- CI artifact link;
- freshness status.

Do not ingest the entire raw graph into BrainMemory. Instead, ingest only reviewed architecture summaries, detected drift, and actionable findings with provenance.

## Bounded self-learning contract

Statenour already has outcome-learning components, including task-completion auto-learn, embeddings, wisdom matching, prediction outcomes, and policy-gated autonomous actions. Improvement should consolidate these mechanisms rather than create another autonomous engine.

The approved loop is:

```text
Observe a verified event
  -> extract candidate lesson
  -> attach evidence and source
  -> score confidence and novelty
  -> compare against existing memory
  -> evaluate for contradiction and risk
  -> persist as candidate or verified memory
  -> use in retrieval or suggestions
  -> measure downstream outcome
  -> reinforce, revise, or retire the lesson
```

### Autonomy levels

1. **Observe:** read data and produce diagnostics. No side effects.
2. **Suggest:** create a proposed lesson, task, or action with evidence.
3. **Approve:** human or policy gate accepts a bounded change.
4. **Act:** execute a reversible, scoped action with a receipt.
5. **Learn:** compare predicted and actual outcomes and update confidence.

### Prohibited shortcuts

- No self-editing system prompts directly from one model output.
- No automatic promotion of NotebookLM text into high-confidence memory.
- No Graphify report treated as current without a commit/freshness check.
- No lesson reinforcement from proxy metrics alone.
- No irreversible external action without the existing approval policy.
- No silent mutation when a provider returns an emergency/fallback response.
- No removal of fabrication, injection, SSRF, auth, or mutation-lock defenses in the name of autonomy.

## Advancement roadmap

### Wave 1 — truthful surfaces

- Separate Obsidian heartbeat, last run, and last successful sync.
- Fail incomplete Obsidian syncs loudly.
- Fix NotebookLM API-envelope handling.
- Remove fake notebook IDs.
- Present Graphify as a snapshot rather than a runtime engine.
- Make BrainMemory's canonical role explicit in the UI.

### Wave 2 — reliable local bridge

- Run Obsidian watch and NotebookLM sidecar as supervised Windows services.
- Add exponential backoff, structured run receipts, and explicit session-expired state.
- Secure the Railway-to-local transport.
- Add a local queue so temporary internet loss does not lose captures.
- Add end-to-end synthetic health checks.

### Wave 3 — governed research ingestion

- Create a shared `KnowledgeCandidate` contract for NotebookLM, Obsidian, web research, and operator capture.
- Require source URI/file hash, observed time, author/system, confidence, claim type, and ingestion version.
- Add contradiction detection and duplicate clustering.
- Require approval for high-impact claims and operating rules.

### Wave 4 — code intelligence automation

- Generate Graphify in a scheduled or merge-triggered workflow.
- Publish the full graph as a CI artifact, not a repository blob.
- Commit only a compact verified manifest and architecture delta.
- Route meaningful architecture drift into the issue/action system.

### Wave 5 — measurable learning

- Connect suggestions and predictions to later outcomes.
- Track calibration, acceptance rate, realized value, false-positive rate, and lesson decay.
- Promote only lessons that survive repeated evidence.
- Retire stale or contradicted memories automatically, with an audit trail.

## Success standard

The system is not advanced because it has many engines. It is advanced when:

- each source has one clear role;
- status indicators are truthful;
- failure is visible;
- every important claim has provenance;
- automation is reversible and policy-gated;
- lessons are evaluated against real outcomes;
- duplicate memory and contradictory truth are controlled;
- optional local tools never destabilize the production app.
