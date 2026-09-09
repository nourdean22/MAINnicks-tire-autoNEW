"""
PreexistingCensus: any vehicle already visible at process startup, or right after a
camera reconnect / V380 app restart / PTZ pose recovery, is PREEXISTING.

A preexisting vehicle may count toward occupancy but must NEVER become a new arrival
by merely remaining visible long enough. It becomes eligible for a real arrival only
after it legitimately departs and re-enters through the portal.

This is the edge-side defense that `visitd` -- a pure function of its event stream --
cannot provide for itself.
"""
from __future__ import annotations


class PreexistingCensus:
    def __init__(self, startup_grace: float = 8.0, reconnect_grace: float = 6.0) -> None:
        self.startup_grace = startup_grace
        self.reconnect_grace = reconnect_grace
        self._reconnect_until: float = float("-inf")
        self.preexisting_count = 0

    def note_reconnect(self, now: float) -> None:
        """Capture recovered from a stall, the app restarted, or the pose is unknown."""
        self._reconnect_until = now + self.reconnect_grace

    def in_blind_window(self, ts: float, start_ts: float) -> bool:
        return (ts - start_ts) < self.startup_grace or ts <= self._reconnect_until

    def classify_birth(self, born_ts: float, start_ts: float) -> str:
        """Return 'preexisting' or 'candidate' for a track born at `born_ts`.

        'candidate' does NOT mean arrived -- it means eligible to be tested against
        entry evidence. Only an actual portal crossing promotes it further.
        """
        if self.in_blind_window(born_ts, start_ts):
            self.preexisting_count += 1
            return "preexisting"
        return "candidate"
