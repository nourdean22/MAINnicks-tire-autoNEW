"""A producer capability that the installer cannot reach does not exist in production.

`edge_main.py` is hand-run maybe twice a week. The scheduled task written by
`scripts/install-edge-runtime.ps1` is how it runs the other 166 hours, unattended, across
reboots -- so the wrapper line in that script is the real, and only, production command
line. Every flag this session added (`--scene-atlas`, `--scene`, `--channel`, `--hard-cases`,
`--hard-case-max-gb`, `--relocate-seconds`, `--shadow-ledger`, `--challenger-model`,
`--adjudicator-model`, `--adjudicator-device`, `--replay`) was built, tested and verified
against live shop pixels while being **unreachable from the installer**. Scene localisation,
the hard-case corpus and the shadow ledger were all, in the only sense that matters,
switched off.

The failure is silent in both directions: the installer runs fine, the producer runs fine,
and the capability is simply absent. Nothing is red. This test is the thing that goes red.

WHY IT RESOLVES VARIABLES INSTEAD OF GREPPING THE FILE
------------------------------------------------------
The wrapper is assembled from per-shape helpers (`$sceneArg`, `$hardCaseArg`, ...) that are
interpolated into one command line. A file-wide grep for `--scene-atlas` would score green
on a helper that was written and then never interpolated -- the orphan-writer shape that has
already shipped twice in this repo (an `hardCases` heartbeat facet Zod stripped; a
`SOURCE_FAILOVER` trigger with no caller). So the resolver walks the actual line: literal
flags on it, plus the flags in the assignments of the variables it interpolates.
`test_a_flag_in_an_UNINTERPOLATED_helper_is_NOT_reachable` is the canary that proves it.
"""
from __future__ import annotations

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER = os.path.join(REPO, "scripts", "install-edge-runtime.ps1")

FLAG_RE = re.compile(r"(?<![\w-])--[a-z][a-z0-9-]*")
VAR_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")

# Flags that are DELIBERATELY not routed through the installer, each with the reason it
# would be wrong or useless to install. This list is the decision record: a new producer
# flag fails this test until someone either threads it or writes down why not. An entry
# here is itself checked -- see `test_no_exemption_has_gone_STALE`.
DELIBERATELY_UNREACHABLE = {
    "--hwnd": "a window handle is re-assigned on every launch; baking one into a task that "
              "survives reboots would target whatever window inherited the number.",
    "--seconds": "stops the producer after N seconds. The whole point of the scheduled task "
                 "is that it runs until signalled.",
    "--motion-gate": "store_true with default=True and no --no-motion-gate counterpart, so "
                     "passing it cannot change behaviour.",
    "--restart-rebind-seconds": "restart continuity is ON at its tested default (20 s from the "
                                "first frame) without the flag; it exists to switch it off (0) "
                                "while diagnosing, not as a per-install knob.",
    "--restart-rebind-max-gap-seconds": "the stranger-inheritance bound (120 s). Raising it per "
                                        "install would trade a known false-continuation risk "
                                        "for coverage; that is a code change with a test, not "
                                        "an installer parameter.",
}


def _significant_lines(text):
    """Drop comment-only lines. A flag named in a comment is documentation, not wiring."""
    return [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]


def wrapper_reachable_flags(installer_text):
    """Flags the generated wrapper's command line can actually carry.

    Returns (flags, wrapper_line). Raises if the wrapper line cannot be found -- a resolver
    that silently returns an empty set on a moved wrapper would report every flag as
    unreachable, which reads as a catastrophe rather than as a broken instrument.

    KNOWN LIMIT, deliberately not fixed: an assignment continued across lines is only read
    as far as its first line, so a flag on the continuation reads as unreachable. That fails
    LOUD (the flag shows up stranded) rather than silently green, which is the right
    direction, and keeping one-line assignments is cheaper than a PowerShell continuation
    parser that has its own ways to be wrong. It already caught one: `$captureArg` was
    written across two lines and `--no-crop` was reported stranded.
    """
    lines = _significant_lines(installer_text)
    wrappers = [ln for ln in lines
                if "edge_main.py" in ln and "--config" in ln and "--camera" in ln]
    if len(wrappers) != 1:
        raise AssertionError(
            f"expected exactly one wrapper command line in the installer, found "
            f"{len(wrappers)}. The resolver below is meaningless until this is fixed.")
    wrapper = wrappers[0]

    # Transitive, because helpers compose: `$captureArg` is built from `$noCropArg`, which
    # never appears on the wrapper line itself. One-level resolution called `--no-crop`
    # stranded while it was correctly wired. Reachability is still anchored AT the wrapper
    # line -- a helper no chain reaches stays invisible, which is the whole point.
    flags = set(FLAG_RE.findall(wrapper))
    pending, seen = list(VAR_RE.findall(wrapper)), set()
    while pending:
        var = pending.pop()
        if var in seen:
            continue
        seen.add(var)
        assign = re.compile(r"^\s*\$" + re.escape(var) + r"\s*=")
        for ln in lines:
            if assign.match(ln):
                flags.update(FLAG_RE.findall(ln))
                pending.extend(VAR_RE.findall(ln))
    return flags, wrapper


def producer_flags():
    """Every long option `edge_main.parse_args` defines, from the parser itself."""
    return {"--" + dest.replace("_", "-") for dest in vars(edge_main.parse_args([]))}


class InstallerFlagDriftTest(unittest.TestCase):

    def setUp(self):
        with open(INSTALLER, encoding="utf-8") as fh:
            self.text = fh.read()
        self.reachable, self.wrapper = wrapper_reachable_flags(self.text)

    def test_EVERY_producer_flag_is_reachable_or_deliberately_excluded(self):
        stranded = sorted(producer_flags() - self.reachable - set(DELIBERATELY_UNREACHABLE))
        self.assertEqual(
            stranded, [],
            f"edge_main accepts {stranded} but the installed scheduled task can never pass "
            f"them, so in production those capabilities are off. Either thread each one "
            f"through install-edge-runtime.ps1 (a typed parameter plus an entry on the "
            f"wrapper line) or add it to DELIBERATELY_UNREACHABLE with the reason.")

    def test_no_exemption_has_gone_STALE(self):
        """An exemption list nobody re-checks becomes a list of lies.

        Two ways an entry rots: the flag was deleted from the producer, or someone later
        threaded it anyway -- and in both cases the entry now silently suppresses a check
        of something else that shares the name.
        """
        real = producer_flags()
        gone = sorted(f for f in DELIBERATELY_UNREACHABLE if f not in real)
        self.assertEqual(gone, [], f"{gone} are exempted but are not producer flags any more")
        contradicted = sorted(f for f in DELIBERATELY_UNREACHABLE if f in self.reachable)
        self.assertEqual(
            contradicted, [],
            f"{contradicted} are listed as deliberately unreachable but the wrapper DOES "
            f"pass them. Delete the exemption; the reason recorded against it is now false.")

    def test_the_parser_and_its_own_SOURCE_agree_on_the_flag_names(self):
        """`producer_flags()` derives names from argparse's dest, which is only the option
        name when nothing overrides `dest=`. If someone adds `dest=`, this test's whole
        vocabulary silently shifts and it starts checking flags that do not exist."""
        with open(os.path.join(REPO, "edge_main.py"), encoding="utf-8") as fh:
            declared = set(re.findall(r'add_argument\(\s*"(--[a-z][a-z0-9-]*)"', fh.read()))
        self.assertEqual(
            sorted(declared - producer_flags()), [],
            "edge_main.py declares a flag whose argparse dest is not its own name (a "
            "dest= override), so this test cannot name it. Read the flags from the parser "
            "actions instead of from dest.")

    def test_the_wrapper_threads_the_flags_this_session_ADDED(self):
        """The positive control for the whole file.

        Without it, a resolver bug that returns a huge set (say, every flag in the file)
        makes the drift test above pass unconditionally. These five are the capabilities
        that were live, tested, and unreachable this morning.
        """
        for flag in ("--scene-atlas", "--hard-cases", "--service-review-seconds",
                     "--shadow-ledger", "--relocate-seconds", "--replay"):
            self.assertIn(flag, self.reachable, f"{flag} is not on the wrapper line")

    def test_the_installers_own_DryRun_does_not_leak_into_the_wrapper(self):
        """`-DryRun` means "print the plan, install nothing". The producer's `--dry-run`
        means "do not POST to StateNour". Naming both `$DryRun` made an install PREVIEW
        change what got installed -- caught by the PowerShell parser, not by a test.

        Note what --dry-run does NOT mean: it gates the StateNour lane only. ShopMirror has
        zero dry_run references by design, so a "dry run" producer still POSTs heartbeats
        and visits to nickstire production.
        """
        self.assertIn("$ProducerDryRun", self.text)
        body = self.text.split("$wrapperBody")[0]
        self.assertNotIn(
            "if ($DryRun) { ' --dry-run' }", body,
            "the producer flag is keyed off the installer's own -DryRun switch again")


class ResolverCanaryTest(unittest.TestCase):
    """Break the instrument and prove it goes red. A green drift test proves nothing until
    the resolver underneath it has been shown to be capable of saying no."""

    A_HELPER = "$aArg = _Arg '--alpha' $A"
    B_HELPER = "$bArg = _Arg '--beta' $B"
    WRAPPER = '"$py" edge_main.py --config "$c" --camera "$cam"$aArg --fps $f'

    def _text(self, *lines):
        return "\n".join(lines) + "\n"

    def test_a_flag_on_the_wrapper_line_is_reachable(self):
        flags, _ = wrapper_reachable_flags(
            self._text(self.A_HELPER, self.B_HELPER, self.WRAPPER))
        self.assertIn("--alpha", flags)

    def test_a_flag_in_an_UNINTERPOLATED_helper_is_NOT_reachable(self):
        """THE canary. `$bArg` is assembled and then never used -- exactly what a naive
        file-wide grep for `--beta` would score as wired."""
        flags, _ = wrapper_reachable_flags(
            self._text(self.A_HELPER, self.B_HELPER, self.WRAPPER))
        self.assertNotIn("--beta", flags,
                         "the resolver is grepping the file, not walking the command line")

    def test_a_flag_reached_THROUGH_another_helper_IS_reachable(self):
        """Helpers compose. `$cArg` never appears on the wrapper line; `$aArg` does, and is
        built from it. One-level resolution called the real `--no-crop` stranded."""
        flags, _ = wrapper_reachable_flags(self._text(
            '$cArg = " --delta $D"',
            "$aArg = (_Arg '--alpha' $A) + $cArg",
            self.WRAPPER))
        self.assertEqual({"--alpha", "--delta"} & flags, {"--alpha", "--delta"})

    def test_a_helper_reached_only_through_an_UNINTERPOLATED_one_is_NOT_reachable(self):
        """Transitivity must not quietly widen into "every assignment in the file".
        `$dArg` feeds `$bArg`, and nothing interpolates `$bArg`."""
        flags, _ = wrapper_reachable_flags(self._text(
            '$dArg = " --epsilon $E"',
            "$bArg = (_Arg '--beta' $B) + $dArg",
            self.A_HELPER,
            self.WRAPPER))
        self.assertEqual({"--beta", "--epsilon"} & flags, set())

    def test_a_flag_named_only_in_a_COMMENT_is_not_reachable(self):
        flags, _ = wrapper_reachable_flags(self._text(
            "# we should really pass --gamma one day", self.A_HELPER, self.WRAPPER))
        self.assertNotIn("--gamma", flags)

    def test_a_MISSING_wrapper_line_raises_instead_of_returning_nothing(self):
        with self.assertRaises(AssertionError):
            wrapper_reachable_flags(self._text(self.A_HELPER, 'echo "no wrapper here"'))

    def test_TWO_wrapper_lines_raise_rather_than_picking_one(self):
        """If the installer ever grows a second command line (a fallback lane, a shadow
        producer), silently checking only the first would leave the other unaudited."""
        with self.assertRaises(AssertionError):
            wrapper_reachable_flags(
                self._text(self.A_HELPER, self.WRAPPER, self.WRAPPER))

    def test_a_CYCLE_between_helpers_terminates(self):
        """PowerShell allows `$x = $x + ...`. A worklist without a seen-set would spin
        forever, and a test suite that hangs is indistinguishable from one that is slow."""
        flags, _ = wrapper_reachable_flags(self._text(
            '$aArg = $bArg + " --alpha"', '$bArg = $aArg + " --beta"', self.WRAPPER))
        self.assertEqual({"--alpha", "--beta"} & flags, {"--alpha", "--beta"})


def installer_role_contract(text: str) -> tuple[bool, bool, bool]:
    """(preserves_existing, rejects_missing, stamps_wrapper)."""
    preserves = (
        "Preserving installed producer role" in text
        and "Groups[1].Value" in text
        and "EDGE_ROLE=(shop|nicksmax|nattynour)" in text
    )
    rejects = (
        'if (-not $Role)' in text
        and "Producer role is required for runtime installation" in text
    )
    stamps = (
        "$roleLine      = if ($Role) { 'set \"EDGE_ROLE=" in text
        and "$roleLine" in text.split("$wrapperBody", 1)[1]
    )
    return preserves, rejects, stamps


class InstallerRoleContractTest(unittest.TestCase):
    def test_runtime_install_preserves_or_requires_role_and_stamps_it(self):
        self.assertEqual(installer_role_contract(_installer_text()), (True, True, True))

    def test_gate_detects_each_missing_leg(self):
        good = _installer_text()
        self.assertEqual(
            installer_role_contract(good.replace("Groups[1].Value", "Value")),
            (False, True, True),
        )
        self.assertEqual(
            installer_role_contract(good.replace(
                "Producer role is required for runtime installation", "role optional"
            )),
            (True, False, True),
        )
        stamp = """$roleLine      = if ($Role) { 'set "EDGE_ROLE="""
        broken_stamp = """$roleLine      = if ($Role) { 'set "EDGE_DISABLED="""
        self.assertEqual(
            installer_role_contract(good.replace(stamp, broken_stamp, 1)),
            (True, True, False),
        )


PER_TASK_PATHS = ("$wrapper", "$logFile")


def _installer_text() -> str:
    with open(INSTALLER, encoding="utf-8") as fh:
        return fh.read()


def per_task_paths(text: str) -> dict:
    """Which per-producer output paths are DERIVED from `-TaskName`, and which are constants.

    Returns {name: True if the assignment mentions the task name, else False}.
    """
    out = {}
    for name in PER_TASK_PATHS:
        pattern = re.compile(r"^\s*" + re.escape(name) + r"\s*=\s*(.+)$", re.M)
        match = pattern.search(text)
        assert match, f"{name} is not assigned anywhere; this gate is reading nothing"
        rhs = match.group(1)
        # Derived either directly from $TaskName or through a variable computed from it.
        out[name] = ("$TaskName" in rhs or "$taskSlug" in rhs or "$suffix" in rhs)
    return out


class InstallerPathsArePerTaskTest(unittest.TestCase):
    """A SECOND producer must not overwrite the first one's wrapper.

    `-TaskName` has always been a parameter, so registering a second producer for a second
    lens succeeded -- and then clobbered the first one's `edge-task.cmd`, because the wrapper
    path was a constant. Both scheduled tasks pointed at one file, so whichever install ran
    last won: the task installed for the LEFT lens would have started the RIGHT camera at its
    next restart, that lens would have gone unwatched, and both tasks would still have read
    `Running` with nothing red anywhere.

    Found by installing a real second producer on 2026-09-10, not by a test. Two producers
    now run side by side on one machine (`sign`/shop-left on port 9091, `right`/shop-right on
    9092), which is what made the collision reachable at all.
    """

    def test_the_wrapper_and_log_are_derived_from_the_task_name(self):
        derived = per_task_paths(_installer_text())
        constant = sorted(name for name, ok in derived.items() if not ok)
        self.assertEqual(
            constant, [],
            f"{constant} are the same for every -TaskName, so installing a second producer "
            f"silently overwrites the first one's. Derive them from $TaskName.")

    def test_the_gate_would_NOTICE_a_constant_path(self):
        """The canary. Without it a rewritten matcher would report every path as per-task."""
        text = '$wrapper = Join-Path $root "edge-task.cmd"\n$logFile = Join-Path $logDir "edge.log"\n'
        self.assertEqual(per_task_paths(text), {"$wrapper": False, "$logFile": False})

    def test_the_gate_ACCEPTS_a_properly_derived_path(self):
        """The other direction: a matcher that called everything constant would fail the
        real installer forever and get deleted rather than fixed."""
        text = ('$suffix = if ($TaskName -eq \'x\') { \'\' } else { "-$TaskName" }\n'
                '$wrapper = Join-Path $root "edge-task$suffix.cmd"\n'
                '$logFile = Join-Path $logDir "edge$suffix.log"\n')
        self.assertEqual(per_task_paths(text), {"$wrapper": True, "$logFile": True})

    def test_an_UNASSIGNED_path_raises_rather_than_passing(self):
        """A rename that removed `$wrapper` would otherwise leave this gate green while
        checking nothing at all."""
        with self.assertRaises(AssertionError):
            per_task_paths('$logFile = Join-Path $logDir "edge$suffix.log"\n')


if __name__ == "__main__":
    unittest.main()
