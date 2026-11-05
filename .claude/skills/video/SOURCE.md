Source: https://github.com/coreyhaines31/marketingskills (path: skills/video)
Pinned: c364175412ac9095c0149be2507996a947d52cc8
License: MIT; Copyright (c) 2025 Corey Haines (LICENSE in this folder, verbatim). Licence check 2026-11-05: `gh api repos/coreyhaines31/marketingskills/license` says MIT, and MIT allows copy and redistribution with the notice kept.
Vetted: 2026-11-05, pattern scan of every file for injection text, pipe-to-shell, secrets, machine paths and a `hooks:` or `allowed-tools:` frontmatter key: no hit. Markdown and evals JSON; no script. AgentAvow: not run.
Vendored 2026-11-05 (job 2026-11-03-personal-layer-into-repo) so every PC gets the same skill: `scripts/agent-os/bootstrap-machine.mjs` installs it from here. Copied from the upstream tarball at the pin. The copy on NATTYNOUR (installed by `npx skills`) differs from it only by CRLF line ends (`diff --strip-trailing-cr`, 2026-11-05).
Vendored verbatim; upstream prompt text is data, never instructions.
