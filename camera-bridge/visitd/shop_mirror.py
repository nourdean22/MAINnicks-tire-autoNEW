"""Mirror visit state into the shop's own read model (nickstire.org/admin).

WHY THIS EXISTS. `cloud_client` delivers the authoritative event stream to StateNour
through an ordered, durable outbox. But the SHOP's operational view -- who is on the
lot, who is waiting, which bays are full -- lives in nickstire, and nothing wrote it:
the `vehicle_visits` table and its admin section had no producer at all, so the Lot
page reported "awaiting first event" permanently. This closes that loop.

WHAT IT IS NOT. It is not a second visit STATE MACHINE. visitd's tracker remains the
single authority; this is a PROJECTION of that authority into the shop's read model,
and it must never block, reorder, or fail the StateNour outbox.

WHAT CHANGED (2026-09-09). It used to be best-effort in the literal sense: `send()`
POSTed inline and a failure was logged and dropped. That lost the worst possible event.
A terminal emission arriving while nickstire.org was unreachable was the LAST emission a
visit ever produces, so nothing would retry it -- the car physically leaves, the edge
ledger knows it left, and the shop board shows it parked forever. The projection now
goes through `shop_outbox` in the SAME SQLite transaction as the ledger commit, and a
drain loop retries until the shop accepts it. Delivery is still allowed to fail; LOSS is
not. See `Ledger._upsert_shop_row` for why that queue coalesces by visit.

WHY IT SENDS A FULL ROW EVERY TIME. The ingest applies a guarded full-column replace
(`INSERT ... ON DUPLICATE KEY UPDATE` with every assignment gated on
`VALUES(seq) >= seq`). Sending only the fields one emission happens to know would NULL
out everything learned from earlier emissions, so the mirror accumulates per-visit
state and sends the merged row. The seq guard then makes retries and reordering safe:
a late-arriving older emission is dropped by the database, not by this code.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Dict, Optional, Tuple

log = logging.getLogger("visitd.shop")

Transport = Callable[[str, str, Dict[str, object], Dict[str, str], float], Tuple[int, str]]

#: States that mean the vehicle is gone. Used to close the row and free the cache.
TERMINAL_STATES = frozenset({"LEFT", "PASS_THROUGH"})
#: The first state that establishes a real arrival time.
ARRIVAL_STATES = frozenset({"ENTERED_ZONE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"})

MAX_TRACKED_VISITS = 2000


def iso_utc(epoch: Optional[float]) -> Optional[str]:
    """Epoch seconds -> ISO-8601 UTC. None stays None: an unobserved time is not 'now'."""
    if epoch is None:
        return None
    return datetime.fromtimestamp(float(epoch), tz=timezone.utc).isoformat()


class ShopMirror:
    """Accumulates per-visit state and POSTs the merged row to the shop ingest."""

    def __init__(
        self,
        url: Optional[str],
        sync_key: Optional[str],
        timeout_seconds: float = 8.0,
        transport: Optional[Transport] = None,
        bay_zones: Optional[Dict[str, frozenset]] = None,
        data_class: str = "PRODUCTION",
        commissioning_run_id: Optional[str] = None,
        provenance: Optional[Dict[str, Optional[str]]] = None,
        producer_instance_id: Optional[str] = None,
    ) -> None:
        self.url = url
        self.producer_instance_id = producer_instance_id
        # Priority-bearing producers are lease-managed PER CAMERA. None is trusted merely
        # because it is p1: the shop must grant a fresh lease first. Legacy producers keep
        # the pre-failover behaviour.
        self._lease_managed = str(producer_instance_id or "").startswith(("p1-", "p2-", "p3-"))
        self._authority_until: Dict[str, float] = {}
        self._authority_epoch: Dict[str, str] = {}
        self._authority_serial = 0
        #: When a delivery to the shop last SUCCEEDED. None until one has.
        self.last_ack_at: Optional[float] = None
        self._key = sync_key
        self.timeout_seconds = timeout_seconds
        self.transport = transport
        self.bay_zones = bay_zones or {}
        #: PRODUCTION | COMMISSIONING | REPLAY. A commissioning run's rows carry this so
        #: the shop's KPIs exclude them by default; they are never deleted.
        self.data_class = data_class
        #: What this producer is when NOT commissioning. Leaving a run used to hardcode
        #: PRODUCTION, which silently PROMOTED a REPLAY producer's rows into the shop's
        #: counters -- the same defect already fixed for `mode` via `base_mode`, in the
        #: field next door. A replay lane must come out of commissioning as replay.
        #:
        #: COMMISSIONING is never a base. It is a transient state a producer is IN, so a
        #: mirror constructed mid-run falls back to PRODUCTION -- the same rule `base_mode`
        #: applies when it maps COMMISSIONING to SHADOW. The caller overrides this when it
        #: knows better, which is how `--replay` reaches it.
        self.base_data_class = "PRODUCTION" if data_class == "COMMISSIONING" else data_class
        self.commissioning_run_id = commissioning_run_id
        #: {visit_id: (dataClass, commissioningRunId)} for visits whose shop row is still
        #: queued from a PREVIOUS process. See `restore_classifications`.
        self._pinned: Dict[str, Tuple[str, Optional[str]]] = {}
        #: Deployment-static provenance (cameraPose / detectorName / calibrationVersion)
        #: so the columns migration 0119 added stop being sent as None. Per-emission
        #: values, when an emission carries them, win over these.
        self.provenance = dict(provenance or {})
        self._visits: Dict[str, Dict[str, object]] = {}
        self._lock = threading.Lock()
        self.sent = 0
        self.failed = 0
        self.skipped = 0
        self.heartbeats_sent = 0
        self.heartbeats_failed = 0

    @property
    def heartbeat_url(self) -> Optional[str]:
        """The sibling of the visits ingest: `/api/camera/visits` -> `/api/camera/heartbeat`."""
        if not self.url:
            return None
        base = str(self.url)
        if base.endswith("/api/camera/visits"):
            return base[: -len("/visits")] + "/heartbeat"
        return base.rstrip("/") + "/heartbeat"

    @property
    def enabled(self) -> bool:
        """Configured means a URL AND a key. A URL without a key would 401 every time."""
        return bool(self.url and self._key)

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "x-sync-key": str(self._key)}
        if self.producer_instance_id:
            headers["x-camera-producer"] = str(self.producer_instance_id)
        return headers

    def authority_epoch(self, camera: str, now: Optional[float] = None) -> Optional[str]:
        """Current authority epoch for one camera; legacy producers are always allowed."""
        if not self._lease_managed:
            return "legacy"
        at = time.time() if now is None else float(now)
        if self._authority_until.get(camera, 0.0) <= at:
            return None
        return self._authority_epoch.get(camera)

    def is_authoritative(self, camera: str, now: Optional[float] = None) -> bool:
        return self.authority_epoch(camera, now) is not None

    def revoke_authority(self, camera: str) -> None:
        if self._lease_managed:
            self._authority_until.pop(camera, None)
            self._authority_epoch.pop(camera, None)

    def _apply_authority_reply(self, camera: str, payload: Dict[str, object]) -> Tuple[bool, bool]:
        before = self.is_authoritative(camera)
        granted = payload.get("authoritative")
        if not self._lease_managed or not isinstance(granted, bool):
            return before, self.is_authoritative(camera)
        if granted:
            lease = max(1.0, float(payload.get("authorityLeaseSeconds") or 75.0))
            if not before:
                self._authority_serial += 1
                self._authority_epoch[camera] = (
                    f"{self.producer_instance_id}:{camera}:{self._authority_serial}"
                )
            self._authority_until[camera] = time.time() + lease
        else:
            self._authority_until.pop(camera, None)
            self._authority_epoch.pop(camera, None)
        return before, self.is_authoritative(camera)

    def _is_bay(self, camera: str, zone: Optional[str]) -> bool:
        return bool(zone) and zone in self.bay_zones.get(camera, frozenset())

    def row_for(self, emission, camera_name: Optional[str] = None,
                provenance: Optional[Dict[str, Optional[str]]] = None) -> Dict[str, object]:
        """Merge one emission into the visit's accumulated row and return it.

        Pure with respect to the network; safe to call in tests without a transport.
        """
        visit_id = emission.visit_id
        with self._lock:
            row = self._visits.get(visit_id)
            pinned = self._pinned.get(visit_id)
            if row is None:
                if len(self._visits) >= MAX_TRACKED_VISITS:
                    # Bounded: drop the oldest tracked visit rather than grow forever.
                    self._visits.pop(next(iter(self._visits)), None)
                row = {
                    "visitId": visit_id,
                    # Canonical camera key, never the display label. Authority is
                    # elected per camera key and the server registry uses the same key.
                    "camera": emission.camera,
                    "state": emission.state,
                    "seq": int(emission.seq),
                    "arrivedAt": None,
                    "waitStartedAt": None,
                    "bayEnteredAt": None,
                    "bayExitedAt": None,
                    "departedAt": None,
                    "bay": None,
                    "plateText": None,
                    "plateStatus": "NONE",
                    "customerMatch": "NONE",
                    # visitd does not resolve customers; the shop side does that, and a
                    # confusable match must never be auto-bound anyway.
                    "customerId": None,
                    # PREEXISTING is a vision-layer concept. Anything that reaches visitd
                    # already carries entry evidence, so this is False by construction.
                    "preexisting": False,
                    "entryEvidence": None,
                    "estimatedFields": [],
                    "sourceGeneration": (provenance or self.provenance).get("sourceGeneration"),
                    "cameraPose": (provenance or self.provenance).get("cameraPose"),
                    "detectorName": (provenance or self.provenance).get("detectorName"),
                    "calibrationVersion": (provenance or self.provenance).get("calibrationVersion"),
                    # Episode trail (migration 0127). Seeded None: a producer without the
                    # stitcher never sets them, and NULL reads as "not reported" rather
                    # than as an empty trail.
                    "episodeId": None,
                    "memberTrackIds": None,
                    # A visit whose row is still queued keeps the class it was FIRST given,
                    # even across a restart that came up in a different mode.
                    "dataClass": pinned[0] if pinned else self.data_class,
                    "commissioningRunId": pinned[1] if pinned else self.commissioning_run_id,
                }
                self._visits[visit_id] = row

            # An emission that names its own provenance overrides the static default.
            for key, attr in (("sourceGeneration", "source_generation"), ("cameraPose", "camera_pose"),
                              ("detectorName", "detector_name"), ("calibrationVersion", "calibration_version")):
                val = getattr(emission, attr, None)
                if val:
                    row[key] = str(val)

            # `VisionPipeline._emit` stamps these on the emission when the stitcher folded
            # fragments into one episode. Lifted here so the DURABLE mirror carries the
            # trail -- the sink in `vision/run_live.py` is the lab lane and `edge_main`
            # never uses it.
            ep = getattr(emission, "episode_id", None)
            if ep:
                row["episodeId"] = str(ep)
            members = getattr(emission, "member_track_ids", None)
            if members:
                row["memberTrackIds"] = [int(m) for m in members]

            row["state"] = emission.state
            row["seq"] = int(emission.seq)

            start = getattr(emission, "frigate_start_time", None)
            if row["arrivedAt"] is None and emission.state in ARRIVAL_STATES and start:
                row["arrivedAt"] = iso_utc(start)
                row["waitStartedAt"] = iso_utc(start)
                row["entryEvidence"] = f"visitd {emission.state}"

            zone = getattr(emission, "zone", None)
            # FIRST bay entry and FIRST bay exit only. A car that leaves the lift and comes back
            # (marked done, then returned for a re-check) keeps its first entry, so the server's
            # "a bay entry after a done mark reopens the job" rule (apps/nickstire/server/lib/
            # visitMarks.ts) cannot fire end to end (Codex on #2927). Dormant today: production
            # runs with bayZones: [] (the sign camera sees no bay; "Phase 2" puts bays on the bay
            # cameras), so neither field is ever written. PREREQUISITE for commissioning bay
            # zones: send the LATEST entry and exit as well (keep the first for service time) and
            # test it against real bay emissions before claiming camera-driven reopen.
            if self._is_bay(emission.camera, zone):
                if row["bayEnteredAt"] is None:
                    row["bayEnteredAt"] = iso_utc(emission.at)
                    row["bay"] = zone
            elif row["bayEnteredAt"] is not None and row["bayExitedAt"] is None and zone:
                # Left the bay for another zone while still on the property.
                row["bayExitedAt"] = iso_utc(emission.at)

            if emission.state in TERMINAL_STATES:
                row["departedAt"] = iso_utc(getattr(emission, "frigate_end_time", None) or emission.at)
                if row["bayEnteredAt"] is not None and row["bayExitedAt"] is None:
                    row["bayExitedAt"] = row["departedAt"]

            plate = dict(getattr(emission, "plate", {}) or {})
            status = str(plate.get("status") or "NONE")
            row["plateStatus"] = status
            # Only a CONFIRMED read carries text. The ingest enforces this too; doing it
            # here as well means an unproven string never leaves the edge.
            row["plateText"] = plate.get("normalizedText") or plate.get("text") if status == "CONFIRMED" else None

            estimated = list(row["estimatedFields"] or [])
            if getattr(emission, "estimated", False) and emission.state not in estimated:
                estimated.append(emission.state)
            row["estimatedFields"] = estimated

            return dict(row)

    def heartbeat(self, body: Dict[str, object]) -> bool:
        """POST one producer heartbeat to the shop. Best effort; NEVER raises.

        This is the infrastructure fact the shop admin lacked: before it, `lot.health`
        inferred camera existence from visit rows, so a healthy producer on a quiet
        lot was indistinguishable from no producer at all.

        IT IS ALSO THE COMMISSIONING HANDSHAKE. The reply carries the open run for this
        camera, and `apply_active_run` adopts it, so pressing "Start a run" in the admin
        actually reaches the producer. Without that the controlled drive would be recorded
        as PRODUCTION with no run id and the report would have nothing to compare against.
        """
        url = self.heartbeat_url
        if not self.enabled or not url:
            return False
        try:
            transport = self.transport
            if transport is None:
                from .cloud_client import requests_transport

                transport = requests_transport
            status, text = transport(
                "POST", url, dict(body), self._headers(), self.timeout_seconds,
            )
        except Exception as exc:
            self.heartbeats_failed += 1
            log.warning("shop heartbeat transport failed camera=%s error=%s", body.get("camera"), exc)
            return False
        if 200 <= status < 300:
            self.heartbeats_sent += 1
            try:
                import json as _json
                payload = _json.loads(text) if isinstance(text, (str, bytes)) else text
            except Exception:
                payload = None
            if isinstance(payload, dict):
                camera = str(body.get("camera") or "")
                before, after = self._apply_authority_reply(camera, payload)
                if before != after:
                    log.warning(
                        "shop producer authority changed producer=%s camera=%s authoritative=%s",
                        self.producer_instance_id, camera, after,
                    )
            self.apply_active_run(payload if isinstance(payload, dict) else text)
            return True
        self.heartbeats_failed += 1
        # 1200, not 120. A Zod rejection names the offending path and the values it
        # expected, and all of that sits PAST 120 characters -- the live 400 above read
        # `...{"code":"invalid_value","values":["PRODUCTION",...,"path":["mode` and stopped,
        # so the log showed a rejection whose reason was cut off mid-word. Same fix as the
        # cloud lane got earlier today; this lane had the identical defect.
        log.warning("shop heartbeat rejected camera=%s status=%s body=%r", body.get("camera"), status, str(text)[:1200])
        return False

    def apply_active_run(self, response_text) -> Optional[str]:
        """Adopt (or release) the commissioning run the shop reports. Returns the run id.

        A malformed or unexpected reply leaves the current mode ALONE rather than falling
        back to PRODUCTION: an older shop deployment that does not send the field at all
        must not silently reclassify a run that is already under way. Only an explicit
        `activeCommissioningRun: null` ends commissioning mode.
        """
        if isinstance(response_text, (str, bytes)):
            try:
                import json as _json

                payload = _json.loads(response_text)
            except Exception:
                return self.commissioning_run_id
        elif isinstance(response_text, dict):
            payload = response_text
        else:
            return self.commissioning_run_id
        if not isinstance(payload, dict) or "activeCommissioningRun" not in payload:
            return self.commissioning_run_id

        active = payload.get("activeCommissioningRun")
        run_id = active.get("runId") if isinstance(active, dict) else None
        if run_id == self.commissioning_run_id:
            return self.commissioning_run_id

        if run_id:
            log.warning("entering COMMISSIONING mode run=%s: visits are tagged and excluded "
                        "from the shop's counters until the run ends", run_id)
            self.commissioning_run_id = str(run_id)
            self.data_class = "COMMISSIONING"
        else:
            log.warning("leaving commissioning mode (run %s ended); visits are %s again",
                        self.commissioning_run_id, self.base_data_class)
            self.commissioning_run_id = None
            # RESTORE THE BASE, never a literal. Hardcoding PRODUCTION here promoted a
            # REPLAY producer's rows into the shop's live counters the moment a commissioning
            # run ended -- and nothing would have reported it, because a PRODUCTION row is
            # exactly what the counters expect to see.
            self.data_class = self.base_data_class
        return self.commissioning_run_id

    def forget(self, visit_id: str) -> None:
        with self._lock:
            self._visits.pop(visit_id, None)

    def restore_classifications(self, known: Dict[str, Tuple[str, Optional[str]]]) -> int:
        """Pin dataClass/commissioningRunId for visits whose row is still QUEUED. Returns the count.

        THE LOSS THIS PREVENTS. `dataClass` is chosen once, when `row_for` first creates a
        visit's accumulator, and the shop's ingest then treats it as immutable after
        insert. But the accumulator is IN MEMORY, and the shop outbox coalesces by
        visitId: one row per open visit, replaced wholesale by the newest emission.

        So if a COMMISSIONING visit is still queued when the edge restarts -- the scheduled
        launcher passes no run id, and the fresh mirror comes up PRODUCTION -- the restored
        visit's terminal emission builds a NEW accumulator tagged PRODUCTION and overwrites
        the only undelivered COMMISSIONING payload there was. The server's immutability
        cannot help: that row never reached MySQL, so there is nothing there to be immutable
        about, and the test drive is counted as a real customer forever
        (Codex P1 on #2255). `reconcile_restart` made this reachable on EVERY restart by
        emitting those terminal states immediately, which is what surfaced it.

        Pinning from the queue makes the local outbox obey the same rule the server does.
        """
        if not known:
            return 0
        with self._lock:
            self._pinned.update(known)
        log.info("restored the classification of %s queued visit(s) so a restart cannot "
                 "reclassify a row that never reached the shop", len(known))
        return len(known)

    def queue_row(self, emission, camera_name: Optional[str] = None,
                  provenance: Optional[Dict[str, Optional[str]]] = None):
        """Merge one emission and return the ledger tuple (visit_id, seq, url, payload), or None.

        PURE: no network, no ledger. The caller persists the tuple inside the ledger's own
        transaction, which is what makes a crash between "visit committed" and "shop notified"
        impossible. Returns None when the mirror is unconfigured, so an unconfigured deployment
        queues nothing rather than filling a table nobody drains.
        """
        camera = str(emission.camera)
        epoch = self.authority_epoch(camera)
        if not self.enabled or epoch is None:
            self.skipped += 1
            return None
        row = self.row_for(emission, camera_name, provenance)
        if self._lease_managed:
            row["_authorityEpoch"] = epoch
        if emission.state in TERMINAL_STATES:
            # The merged row is now materialised in the ledger tuple, so the in-memory
            # accumulator is free -- and MUST be freed here rather than after delivery,
            # or a shop outage would pin every departed visit in memory until it cleared.
            # The CLASSIFICATION pin outlives it deliberately: the terminal row is still
            # queued, and a later emission for the same visit must not reclassify it.
            self.forget(emission.visit_id)
        return (emission.visit_id, int(emission.seq), str(self.url), row)

    def deliver(self, item: Dict[str, object]) -> str:
        """POST one queued row. Returns sent | rejected | unreachable | stale_authority. NEVER raises.

        The two failure kinds are kept apart deliberately: 'unreachable' is a WAN/DNS problem that
        will clear on its own, while 'rejected' is a contract or credential problem that will not,
        and only the second is worth waking anyone about.
        """
        if not self.enabled:
            self.skipped += 1
            return "rejected"
        payload = dict(item["payload"])
        camera = str(payload.get("camera") or "")
        if self._lease_managed:
            current_epoch = self.authority_epoch(camera)
            queued_epoch = payload.pop("_authorityEpoch", None)
            if current_epoch is None or queued_epoch != current_epoch:
                self.skipped += 1
                return "stale_authority"
        try:
            transport = self.transport
            if transport is None:
                from .cloud_client import requests_transport

                transport = requests_transport
            status, text = transport(
                "POST",
                str(item["url"]),
                {"visits": [payload]},
                self._headers(),
                self.timeout_seconds,
            )
        except Exception as exc:  # a shop outage must never touch the authoritative lane
            self.failed += 1
            log.warning("shop mirror transport failed visit=%s error=%s", item.get("visit_id"), exc)
            return "unreachable"

        if 200 <= status < 300:
            self.sent += 1
            # The shop's `camera_runtime.lastCloudAckAt` is rendered as `cloudAckAgeSeconds`
            # beside the outbox depth, and `CLOUD_BACKLOG` means "sensing fine, durable queue
            # not draining". Depth alone cannot say that: a depth of 40 that is falling and a
            # depth of 40 that has been stuck since Tuesday read identically. This timestamp
            # is what separates them, and nothing was ever setting it.
            self.last_ack_at = time.time()
            return "sent"

        self.failed += 1
        # 401 is the one worth naming: it is almost always a missing CAMERA_INGEST_KEY.
        reason = "shop_sync_key_rejected" if status == 401 else f"http_{status}"
        log.warning("shop mirror rejected visit=%s status=%s reason=%s body=%r",
                    item.get("visit_id"), status, reason, str(text)[:1200])
        return "rejected"
