# Nick's Tire & Auto Current Truth

This compatibility entrypoint exists because repository instructions historically referenced `truth_os.md`.

The active operating contract is:

- [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md)
- [`docs/METRICS-CONTRACT.md`](docs/METRICS-CONTRACT.md)
- [`docs/ISSUE-REGISTRY.md`](docs/ISSUE-REGISTRY.md)
- [`docs/REVENUE-OPS-ROADMAP.md`](docs/REVENUE-OPS-ROADMAP.md)
- [`docs/operations/SMS-REVENUE-AGENT-OS.md`](docs/operations/SMS-REVENUE-AGENT-OS.md) — operator runbook for the SMS Revenue Agent OS (2026-07-29 arc: levers, gates, daily loop, symptom table)

Two 2026-08-07 contracts worth knowing before you debug a quiet automation, both
detailed in `docs/CURRENT-TRUTH.md`:

- **Live IG publishing is gated by an independent judge, fail-CLOSED.** If the
  judge lane is unreachable, autoposting pauses loudly rather than publishing
  blind. Escape hatch: `IG_SHADOW_JUDGE=false`.
- **The AI receptionist prompt has a measurement loop behind it** (Call Ossuary →
  ghost replay → weekly optimizer). It only ever emits PROPOSALS — **Push Config
  is still the one serving gate**, and four prompt fixes reached the live line
  that way on 2026-08-07.

The older file under `docs/_archive/root_reports/truth_os.md` is historical evidence only. Do not treat archived audit claims as current without re-verification.