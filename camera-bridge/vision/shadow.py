"""What a CHALLENGER would have decided, recorded beside what the champion actually did.

WHY A COUNTERFACTUAL AND NOT A SCORE. "The new detector is 2.1 mAP better" does not answer
the only question that matters here, which is: if this model had been authoritative last
Tuesday, which VISITS would have differed? A shop cares about false arrivals, missed
arrivals, split visits and merged customers -- and a model can improve on every academic
metric while getting more of those wrong, because none of them are what mAP measures.

So a challenger runs beside the champion and writes down its disagreements. It never gets a
vote. The champion's decision is the one that reaches `VisitTracker`, every time, and this
module has no path by which that can change -- which is deliberate: a challenger that could
promote itself on its own evidence is a system marking its own exam.

WHAT MAKES A ROW USEFUL LATER. Not the confidence. A row has to carry enough to reconstruct
WHY the two differed -- which model, on which frame, under which scene and layout epoch,
with which reason codes -- because six months from now the question will be "show me every
time the challenger would have created a visit that never happened", and a bare pair of
numbers cannot answer it.

DELIBERATELY APPEND-ONLY AND BOUNDED. Append-only because a counterfactual record that can
be edited is not evidence. Bounded because this writes on every disagreement, and a
recorder that fills the disk takes the shop's camera down with it -- which is a far worse
outcome than losing the oldest week of a research artefact.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

#: What a decision was ABOUT. Kept small and closed on purpose: an open vocabulary here
#: becomes a pile of one-off strings that no later query can group.
SUBJECTS = ("VEHICLE_COUNT", "ARRIVAL", "DEPARTURE", "PREEXISTING", "TRACK_IDENTITY")


@dataclass
class ShadowStats:
    """Whether this ledger is doing anything. Read it before believing an empty file."""

    considered: int = 0
    agreements: int = 0
    disagreements: int = 0
    written: int = 0
    dropped_unknown_subject: int = 0
    dropped_write_error: int = 0
    rotated: int = 0
    last_error: Optional[str] = None

    @property
    def healthy(self) -> bool:
        """Every attempted write landed.

        NOT "has written a row". Total agreement between champion and challenger is a
        perfectly good outcome -- arguably the best one -- and reporting it as unhealthy
        would train whoever reads this to ignore the field.
        """
        return self.dropped_write_error == 0

    @property
    def disagreement_rate(self) -> Optional[float]:
        """Disagreements over decisions CONSIDERED, or None when nothing was considered.

        None rather than 0.0, because "the challenger never ran" and "the challenger agreed
        every time" are opposite findings that would otherwise render identically -- and the
        first one silently means a promotion gate is measuring nothing.
        """
        if self.considered == 0:
            return None
        return self.disagreements / self.considered

    def describe(self) -> str:
        rate = self.disagreement_rate
        shown = "n/a" if rate is None else f"{rate:.3f}"
        return (f"considered={self.considered} agree={self.agreements} "
                f"disagree={self.disagreements} rate={shown} written={self.written} "
                f"dropped_error={self.dropped_write_error} rotated={self.rotated}")


@dataclass
class ShadowLedger:
    """Append-only JSONL of champion-vs-challenger disagreements.

    `champion_model` and `challenger_model` are recorded on EVERY row rather than once in a
    header. A ledger is read long after it is written, often after both models have been
    replaced, and a row that cannot name the two things it compared is an anecdote.
    """

    path: str
    champion_model: str
    challenger_model: str
    #: Bytes before the file is rotated to `.1` and started fresh. One generation is kept:
    #: this is a research artefact, and the newest disagreements describe the system as it
    #: is now.
    max_bytes: int = 64 * 1024 * 1024
    #: Record agreements too? Off by default. Agreement is the common case and writing it
    #: turns a signal into a log, but a promotion gate measuring a RATE needs the
    #: denominator -- which `stats.considered` carries without the disk cost.
    record_agreements: bool = False

    stats: ShadowStats = field(default_factory=ShadowStats)

    def note(self, subject: str, champion: Any, challenger: Any, *,
             at: float, context: Optional[Dict[str, Any]] = None) -> bool:
        """Record one counterfactual. Returns whether a row was written.

        Returning False is ordinary: it means the two agreed, which is what should usually
        happen and is counted rather than written.
        """
        if subject not in SUBJECTS:
            # An unknown subject is a caller bug. Guessing would scatter one decision class
            # across two names and make every later query quietly incomplete.
            self.stats.dropped_unknown_subject += 1
            return False
        self.stats.considered += 1
        if champion == challenger:
            self.stats.agreements += 1
            if not self.record_agreements:
                return False
        else:
            self.stats.disagreements += 1

        row = {
            "at": round(float(at), 3),
            "subject": subject,
            "champion": {"model": self.champion_model, "decision": _plain(champion)},
            "challenger": {"model": self.challenger_model, "decision": _plain(challenger)},
            "agreed": champion == challenger,
            "context": _plain(context or {}),
        }
        return self._append(row)

    def _append(self, row: Dict[str, Any]) -> bool:
        try:
            self._rotate_if_needed()
            parent = os.path.dirname(self.path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(row, sort_keys=True) + "\n")
        except Exception as exc:  # noqa: BLE001 - research data never outranks the lot
            self.stats.dropped_write_error += 1
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            return False
        self.stats.written += 1
        return True

    def _rotate_if_needed(self) -> None:
        try:
            if os.path.exists(self.path) and os.path.getsize(self.path) >= self.max_bytes:
                backup = self.path + ".1"
                if os.path.exists(backup):
                    os.remove(backup)
                os.replace(self.path, backup)
                self.stats.rotated += 1
        except OSError as exc:
            # A rotation that fails must not stop the append: a ledger slightly over budget
            # is a much smaller problem than a ledger that silently stops recording.
            self.stats.last_error = f"rotation failed: {type(exc).__name__}: {exc}"


def _plain(value: Any) -> Any:
    """Coerce to something `json.dumps` accepts, without ever raising.

    A row that cannot be serialised would take the whole append down, and the caller handed
    us a decision object precisely because it is domain-specific. Anything unrecognised
    becomes its repr, which is worth more later than a missing row.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_plain(v) for v in value]
    return repr(value)


def read_rows(path: str) -> List[Dict[str, Any]]:
    """Every readable row. A corrupt line is SKIPPED, not fatal, and not silent.

    A JSONL file written by a process that was killed mid-write ends in a partial line, and
    refusing to read the whole ledger because of its last 40 bytes would throw away every
    disagreement recorded before the crash.
    """
    rows: List[Dict[str, Any]] = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                rows.append({"_unreadable": line[:120]})
    return rows


def summarise(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Group disagreements by subject -- the shape the question is actually asked in.

    "Would this model have created visits that never happened?" is a question about
    ARRIVAL rows specifically, and an overall disagreement count cannot answer it.
    """
    by_subject: Dict[str, int] = {}
    unreadable = 0
    for row in rows:
        if "_unreadable" in row:
            unreadable += 1
            continue
        if row.get("agreed"):
            continue
        subject = str(row.get("subject", "?"))
        by_subject[subject] = by_subject.get(subject, 0) + 1
    return {"disagreements": sum(by_subject.values()), "bySubject": by_subject,
            "unreadableRows": unreadable, "rows": len(rows)}
