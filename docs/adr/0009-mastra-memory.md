# ADR-0009 · Mastra memory · in-process Phase 1.2 → Postgres Phase 1.3

> **Status**: Accepted (2026-05-17 · Wave-200 Phase 1.2)
> **Decision drivers**: AGENT_V2 path needs real conversational
> continuity · operator stays migration-cautious · zero schema impact
> for the first cutover · persistent storage parked for Phase 1.3

---

## Context

WAVE-200 Phase 1 shipped Nick as a real Mastra agent with the 138-tool
catalog and the skill recall layer. What it did NOT ship was Mastra's
own memory layer. Every turn through the AGENT_V2 path started from
scratch: no working memory · no last-N message window · no
conversation summary.

The legacy chat route handles all this via its 1800-LOC prompt
assembly pipeline. Mastra's AGENT_V2 early-exit path skips that
entirely (by design · the whole point of Mastra is that the agent
manages its own state). So today AGENT_V2 has FEWER memory
capabilities than the legacy path · that's a regression we can't
ship into prod.

Phase 1.2 adds Mastra memory · the question is what storage to use.

## Decision

**Phase 1.2 · in-process default storage. Phase 1.3 · `@mastra/pg`
against Neon with auto-created `mastra_*` tables.**

This is a two-step rollout that keeps the migration-cautious operator
in control of when database schema changes happen.

### Phase 1.2 · ship in-process today

`new Memory({ options: { lastMessages: 20, workingMemory: { ... } } })`
with NO explicit storage adapter. Mastra falls back to its built-in
in-process default · a Map-backed store that lives in the Node
process memory.

What this gets us:
- **Working memory** · the operator's "in-flight commitments / current
  focus / observed preferences" markdown that hydrates into the
  system prompt each turn. Resource-scoped so it follows the operator
  across all their conversations within the same process lifetime.
- **Last-20 message window** · multi-turn refinement works without
  the operator having to repeat context.
- **Zero schema impact** · no new tables · no Prisma migration · no
  coordination with the operator's "no prod DB schema changes
  without a parked migration first" rule.

What this does NOT get us:
- Cold-restart durability · cycling the Railway pod loses the working
  memory for any in-flight conversation
- Cross-pod durability · if the operator scales to >1 web instance
  later, each instance has its own memory state

Both gaps are acceptable for Phase 1.2 because:
1. The operator runs a single web instance today · no cross-pod gap
2. Cold restarts are rare (Railway redeploys + occasional bounces) ·
   maybe weekly · operator can re-explain
3. The PERSISTENT long-term memory (BrainMemory · 100K+ rows) still
   lives in Postgres and is read by the existing recall layer on
   every turn. Mastra memory is for CONVERSATION state, not LIFETIME
   state.

### Phase 1.3 · swap to Postgres when ready

`new Memory({ storage: new PgStore({ connectionString: process.env.DATABASE_URL, tablePrefix: "mastra_" }), options: {...} })`.

The `@mastra/pg` adapter auto-creates its tables (`mastra_messages`,
`mastra_threads`, `mastra_working_memory`, etc.) on first use. They
live OUTSIDE Prisma's ownership · no Prisma migration needed · the
operator can `\d mastra_*` to see what shows up before/after the
deploy.

Phase 1.3 ships in a separate commit after the operator confirms
they're comfortable with the Mastra-managed tables appearing in Neon.
Until then, Phase 1.2 carries the load.

## Rejected alternatives

### Use `@mastra/libsql` with a local SQLite file

The libsql adapter is the lightest persistent option · file-based ·
zero infrastructure. Rejected because:
- Railway containers are ephemeral · the file dies on every redeploy
- Mounting persistent volume just for this would add a dependency
- We already have Postgres · the eventual Phase 1.3 target is
  obviously PG, not libsql

### Skip Mastra memory entirely · reuse legacy recall path

Pipe Mastra's `instructions` through the legacy `buildSystemPrompt`
function so AGENT_V2 inherits all the existing recall. Rejected
because:
- Defeats the purpose of Mastra (single source of truth for state)
- Doubles the prompt-assembly path · we'd have BOTH Mastra's
  instructions AND the legacy buildSystemPrompt running per turn
- The whole Wave-200 reason for adopting Mastra was to MOVE this
  responsibility into the platform, not split it

### Wire Mastra memory directly to the existing BrainMemory table

Use BrainMemory as Mastra's storage by writing a custom adapter that
maps Mastra's message + thread + working-memory schema onto our
BrainMemory rows. Rejected because:
- BrainMemory is a flat key/value/embedding bag · Mastra needs
  relational thread → message linkage · the impedance mismatch
  would require ~300 LOC of glue code we'd have to maintain forever
- Mastra's own tables are battle-tested · ours would be ad hoc
- Phase 1.3 with `tablePrefix: "mastra_"` gets us native Mastra
  schemas in the SAME Postgres at zero glue cost

## Consequences

### Positive

- AGENT_V2 cutover gains conversational continuity in one commit
- Zero schema risk · operator stays in control of migrations
- Phase 1.3 is a 3-line swap (add storage param) · trivial to follow
  up when ready
- Working memory template is auditable Markdown · operator can read
  what the agent thinks it knows about them
- Race-safe promise singleton matching the rest of the Mastra
  scaffold

### Negative

- Cold-restart and cross-pod gaps documented above · acceptable
  short-term
- The `as never` cast in `nick.ts` continues per the documented
  Mastra/AI-SDK version drift · no change

### Neutral

- `getNickMemory()` is its own lazy singleton independent of
  `getNickAgent()` so the agent factory awaits both as separate
  promises

## Operator action items

None blocking. Future:
- Phase 1.3 install: `pnpm --filter @statenour/web add @mastra/pg`
- Phase 1.3 wire: pass `storage: new PgStore({...})` to `new Memory(...)`
- Verify `mastra_*` tables appear in Neon · then ramp AGENT_V2 to
  100% with confidence

## References

- `apps/statenour/src/mastra/memory.ts` · Phase 1.2 factory
- `apps/statenour/src/mastra/agents/nick.ts` · `memory` field wired
- `@mastra/memory` v1.18.2 docs · `Memory` class + `MemoryConfig`
- ADR-0001 · Mastra adoption (Phase 1 substrate)
- ADR-0005 · Inngest (durability for batch workflows · separate
  concern from per-conversation memory)
- WAVE-200-PLAN.md · Phase 1.2 entry
