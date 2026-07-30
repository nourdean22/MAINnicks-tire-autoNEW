"""Render an aggregated community-level graph.html from graphify-out/graph.json.

Why this exists: graphify's `to_html` has a node cap (default 5,000). It can fall
back to a community-aggregated meta-graph instead of refusing to render, but that
fallback only fires when `node_limit` is passed as an ARGUMENT — the
GRAPHIFY_VIZ_NODE_LIMIT env var takes a different branch (export.py:655).
`graphify update` (watch.py:1033) calls to_html without the argument, so the
scheduled sync can never reach the aggregated view. This script calls the public
API with the argument, producing a browser-friendly view of the whole graph
(one node per community) regardless of repo size.

Usage: python scripts/graphify-render-communities.py [output.html]
Default output: graphify-out/graph-communities.html
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

from networkx.readwrite import json_graph

from graphify.export import to_html

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "graphify-out"
GRAPH_JSON = OUT_DIR / "graph.json"
LABELS_JSON = OUT_DIR / ".graphify_labels.json"

# Matches what graphify's own CLI passes when a graph is over cap
# (__main__.py:3691, 4206) — anything above this aggregates by community.
NODE_LIMIT = 5000


def _cid(value: object) -> int:
    """Community ids round-trip through JSON as strings, but to_html does
    `cid % len(COMMUNITY_COLORS)` (export.py:816) and needs ints."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_DIR / "graph-communities.html"

    if not GRAPH_JSON.exists():
        print(f"[communities] no graph.json at {GRAPH_JSON} - nothing to render")
        return 1

    raw = json.loads(GRAPH_JSON.read_text(encoding="utf-8"))
    G = json_graph.node_link_graph(raw, edges="links")

    communities: dict[int, list[str]] = defaultdict(list)
    for node_id, data in G.nodes(data=True):
        communities[_cid(data.get("community", 0))].append(node_id)

    if not communities:
        print("[communities] graph has no community assignments - skipping")
        return 1

    labels: dict[int, str] = {}
    if LABELS_JSON.exists():
        try:
            labels = {
                _cid(k): v
                for k, v in json.loads(LABELS_JSON.read_text(encoding="utf-8")).items()
            }
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[communities] labels unreadable ({exc}) - rendering without them")

    target.parent.mkdir(parents=True, exist_ok=True)
    # to_html hardcodes the literal string "graph.html" in its aggregated-write
    # message (export.py:703) regardless of the path it was handed, so the line
    # names a file we did not write and reads as a regression in the sync log.
    # Capture and relabel it rather than swallow it - the node/edge counts it
    # reports are the only place those aggregate numbers surface.
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        to_html(
            G,
            dict(communities),
            str(target),
            community_labels=labels or None,
            node_limit=NODE_LIMIT,
        )
    for line in captured.getvalue().splitlines():
        if line.strip():
            print(line.replace("graph.html", target.name))

    if not target.exists():
        # to_html returns without writing when the aggregate would be a single
        # community — a real outcome, not an error, but say so out loud.
        print(f"[communities] no file written (single community?) -> {target}")
        return 0

    size = target.stat().st_size
    print(
        f"[communities] wrote {target.name}: {size:,} bytes "
        f"({size / 1024 / 1024:.1f} MB) from {G.number_of_nodes():,} nodes "
        f"/ {len(communities):,} communities"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
