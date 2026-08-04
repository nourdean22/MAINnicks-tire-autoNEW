# statenour-worker · Claude adapter

Service rules, real env contract, and the fail-closed invariants: [`AGENTS.md`](./AGENTS.md) — read
it first. Deploy contract: [`DEPLOY.md`](./DEPLOY.md). Cross-cutting repo rules: root
[`AGENTS.md`](../../AGENTS.md).

Claude-specific: this app has no test suite, so `pnpm --filter @statenour/worker check` plus a build
is the whole local gate — say exactly that in your receipt rather than implying tests ran.
