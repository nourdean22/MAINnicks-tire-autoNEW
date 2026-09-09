"""Make `pytest` from this directory collect BOTH suites.

Without this file the two test trees have different, undocumented invocation
contracts and only one of them runs at a time:

  * `camera-bridge/tests/` (visitd) carries an `__init__.py`, so pytest's prepend
    import mode treats `camera-bridge/` as the base and `import helpers` — which
    every one of those modules does — raises ModuleNotFoundError. They pass only
    when pytest is invoked from INSIDE `tests/`, where the cwd supplies the path.
  * `camera-bridge/vision/tests/` has no `__init__.py` and imports `vision.*`, so
    it needs `camera-bridge/` on the path instead — i.e. the opposite cwd.

So `pytest` from here collected nothing runnable, and there was no single command
that ran the whole package. Adding both directories to sys.path removes the trap
rather than encoding it in a runbook nobody reads.
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent

for _p in (_ROOT, _ROOT / "tests"):
    _s = str(_p)
    if _s not in sys.path:
        sys.path.insert(0, _s)
