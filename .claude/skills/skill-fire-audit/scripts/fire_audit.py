#!/usr/bin/env python3
"""Measure which skills and plugins actually get used. READ-ONLY — proposes, never moves.

Usage:  python fire_audit.py [--days N] [--json OUT.json]

Encodes four corrections learned the hard way on 2026-08-03; each comment marks a
bug that produced a confident wrong answer before it was fixed.
"""
import os, re, json, sys, glob, collections, datetime

HOME = os.path.expanduser("~")
SKILL_ROOTS = [
    ("user", os.path.join(HOME, ".claude", "skills")),
    ("plugin", os.path.join(HOME, ".claude", "plugins")),
    ("project", os.path.join(os.getcwd(), ".claude", "skills")),
    ("project-agents", os.path.join(os.getcwd(), ".agents", "skills")),
    # BUG 4: the first audit missed apps/*/.claude/skills entirely and undercounted
    # the project cohort. Glob it explicitly.
]
for p in glob.glob(os.path.join(os.getcwd(), "apps", "*", ".claude", "skills")):
    SKILL_ROOTS.append(("project-app", p))

TRANSCRIPTS = os.path.join(HOME, ".claude", "projects")
KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*)$")
SLASH_RE = re.compile(r"<command-name>\s*/?([A-Za-z0-9_:\-]+)")
MCP_RE = re.compile(r'"name"\s*:\s*"mcp__([A-Za-z0-9_\-]+?)__')

# BUG 3: a position-0 regex (^Use (when|this|before|for)) graded "Use at the end of
# a wave" and "Use as the FIRST action" as failures -- 54% false positives. A trigger
# anywhere in the description is what matters; position 0 is style, not routing.
TRIGGER_RE = re.compile(
    r"\buse\s+(when|whenever|this|these|it|before|after|at\b|as\b|for\b|during|on\b)"
    r"|\byou\s+must\s+use\b|\bapply\s+(when|whenever|before|after)\b", re.I)


def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}
    lines = text.split("\n")
    end = next((i for i in range(1, min(len(lines), 300)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}
    data, key = {}, None
    for line in lines[1:end]:
        m = KEY_RE.match(line)
        if m and not line.startswith((" ", "\t")):
            key = m.group(1)
            data[key] = m.group(2).strip()
        elif key and line.strip():
            data[key] = (data[key] + " " + line.strip()).strip()
    return data


def clean(v):
    v = (v or "").strip()
    for _ in range(2):
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
    return re.sub(r"^[>|]-?\s*", "", v).strip()


def collect_skills():
    out, seen = [], set()
    for origin, root in SKILL_ROOTS:
        if not os.path.isdir(root):
            continue
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in (".git", "node_modules")]
            if "SKILL.md" not in fn:
                continue
            p = os.path.join(dp, "SKILL.md")
            rp = os.path.realpath(p)
            if rp in seen:
                continue
            seen.add(rp)
            try:
                text = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            fm = parse_frontmatter(text)
            plugin = ""
            if origin == "plugin":
                rel = os.path.relpath(dp, root).split(os.sep)
                plugin = rel[1] if len(rel) > 1 else rel[0]
            out.append({
                "path": p, "origin": origin, "plugin": plugin,
                "name": clean(fm.get("name")) or os.path.basename(dp),
                "desc": clean(fm.get("description")),
                "words": len(text.split()),
            })
    return out


def scan_usage(cutoff=None):
    """Count Skill tool_use, slash commands, and MCP calls."""
    skill, slash, mcp = collections.Counter(), collections.Counter(), collections.Counter()
    files = 0
    for dp, dn, fn in os.walk(TRANSCRIPTS):
        for f in fn:
            if not f.endswith(".jsonl"):
                continue
            fp = os.path.join(dp, f)
            if cutoff and datetime.datetime.fromtimestamp(os.path.getmtime(fp)) < cutoff:
                continue
            files += 1
            try:
                for line in open(fp, encoding="utf-8", errors="replace"):
                    if "<command-name>" in line:
                        for m in SLASH_RE.finditer(line):
                            slash[m.group(1).split(":")[-1]] += 1
                    if "mcp__" in line:
                        for m in MCP_RE.finditer(line):
                            mcp[m.group(1)] += 1
                    if '"Skill"' not in line:
                        continue
                    try:
                        o = json.loads(line)
                    except Exception:
                        continue
                    msg = o.get("message") or {}
                    c = msg.get("content")
                    if not isinstance(c, list):
                        continue
                    for b in c:
                        if isinstance(b, dict) and b.get("type") == "tool_use" \
                           and b.get("name") == "Skill":
                            s = (b.get("input") or {}).get("skill")
                            if isinstance(s, str) and s.strip():
                                skill[s.strip().split(":")[-1]] += 1
            except OSError:
                continue
    return skill, slash, mcp, files


def main():
    days = None
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=days)) if days else None

    skills = collect_skills()
    sk, sl, mcp, files = scan_usage(cutoff)

    # BUG 1: counting only Skill tool_use under-reports. A slash invocation IS a use --
    # the first pass nearly archived social-post-writer-seo (/social-post-writer-seo x2).
    fired = collections.Counter()
    fired.update(sk)
    fired.update(sl)

    by_name = collections.defaultdict(list)
    for s in skills:
        by_name[s["name"]].append(s)

    total_names = len(by_name)
    live = {n for n in by_name if fired.get(n, 0) > 0}
    words_all = sum(s["words"] for s in skills)
    words_dead = sum(s["words"] for s in skills if s["name"] not in live)

    print("=" * 78)
    print(f"SKILL FIRE AUDIT{'  (last %d days)' % days if days else ''}")
    print("=" * 78)
    print(f"  transcripts scanned : {files}")
    print(f"  SKILL.md files      : {len(skills)}")
    print(f"  distinct names      : {total_names}")
    print(f"  ever fired          : {len(live)}  ({100*len(live)/max(1,total_names):.1f}%)")
    print(f"  total invocations   : {sum(fired.values())}")
    print(f"  words in dead skills: {words_dead:,} / {words_all:,} "
          f"({100*words_dead/max(1,words_all):.0f}%)")

    print("\n  by scope (fire rate is the whole point -- project skills should lead):")
    for origin in ("project", "project-agents", "project-app", "user", "plugin"):
        grp = [s for s in skills if s["origin"] == origin]
        if not grp:
            continue
        names = {s["name"] for s in grp}
        f = len([n for n in names if n in live])
        print(f"    {origin:<15} {len(names):>5} names  {f:>4} fired  "
              f"{100*f/max(1,len(names)):>5.1f}%")

    print("\n  TOP 20 BY INVOCATION")
    for n, c in fired.most_common(20):
        where = by_name[n][0]["origin"] if n in by_name else "NOT-ON-DISK"
        print(f"    {c:>5}  [{where}] {n}")

    # description quality on the skills that actually fire -- ignore the dead ones
    weak = [n for n in sorted(live) if n in by_name
            and not TRIGGER_RE.search(by_name[n][0]["desc"] or "")]
    print(f"\n  LIVE SKILLS WITH NO ROUTING TRIGGER ({len(weak)}) -- fix these first:")
    for n in weak:
        print(f"    {n}: {(by_name[n][0]['desc'] or '(none)')[:70]!r}")

    # plugin view: a plugin is live if ANY of its skills fired OR its MCP server was called
    print("\n  PLUGINS WITH ZERO SKILL USAGE (uninstall CANDIDATES -- verify MCP first):")
    pl = collections.defaultdict(set)
    for s in skills:
        if s["plugin"]:
            pl[s["plugin"]].add(s["name"])
    for p, names in sorted(pl.items(), key=lambda kv: -len(kv[1])):
        if any(n in live for n in names):
            continue
        hits = sum(c for srv, c in mcp.items() if p.lower() in srv.lower())
        note = f"MCP called {hits}x -- KEEP" if hits else "no MCP calls seen"
        print(f"    {p:<26} {len(names):>3} skills   {note}")

    print("\n" + "=" * 78)
    print("BEFORE ARCHIVING ANYTHING")
    print("=" * 78)
    print("""  1. Reference-check every candidate against skills you are KEEPING. On the
     2026-08-03 pass this rejected 44% of candidates -- including all 9 persona
     skills, which multi-advisor convenes as a panel.
  2. Check referrer LIVENESS, not just presence. multi-advisor was "referenced by
     two skills" -- both of which had never fired. Dead text is not a dependency.
  3. Read the file before judging it by a number. Word count ranked a customized
     brainstorming skill (allowed-tools, hard gate, review date) below a generic
     plugin copy and recommended deleting it.
  4. NEVER hand-move plugin files. Plugin state lives in THREE places --
     installed_plugins.json, the cache dir, and settings.json enabledPlugins --
     and a running Claude Code re-syncs them. Use /plugin, app closed.
  5. Archive by MOVING with a restore.ps1. Never delete.""")

    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        json.dump({"skills": skills, "fired": dict(fired), "mcp": dict(mcp),
                   "live": sorted(live), "weak_triggers": weak},
                  open(out, "w", encoding="utf-8"), indent=1)
        print(f"\n  wrote {out}")


if __name__ == "__main__":
    main()
