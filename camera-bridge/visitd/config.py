"""YAML + environment configuration for visitd (schema documented in config.example.yaml)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .state_machine import CameraSpec, TopologyLink, VisitPolicy


class ConfigError(ValueError):
    """Raised for a config that would make visitd run wrong."""


@dataclass(frozen=True)
class MqttConfig:
    host: str = "mqtt"
    port: int = 1883
    username: Optional[str] = None
    password: Optional[str] = None
    topic_prefix: str = "frigate"
    client_id: str = "visitd"
    keepalive: int = 60
    queue_max: int = 10000


@dataclass(frozen=True)
class BackendConfig:
    base_url: str = "https://bdnick.info"
    sync_key: Optional[str] = None
    timeout_seconds: float = 8.0
    heartbeat_seconds: float = 60.0
    retry_min_seconds: float = 1.0
    retry_max_seconds: float = 60.0
    outbox_max_depth: int = 5000
    outbox_max_attempts: int = 40


@dataclass(frozen=True)
class CameraConfig:
    name: str
    cloud_device_id: str
    display_name: str
    arrival_zones: Tuple[str, ...]
    bay_zones: Tuple[str, ...]
    zone_names: Dict[str, str] = field(default_factory=dict)

    def spec(self) -> CameraSpec:
        """State-machine view of this camera."""
        return CameraSpec(name=self.name, arrival_zones=frozenset(self.arrival_zones), bay_zones=frozenset(self.bay_zones))


@dataclass(frozen=True)
class Config:
    mqtt: MqttConfig
    backend: BackendConfig
    cameras: Dict[str, CameraConfig]
    policy: VisitPolicy
    ledger_path: str = "./data/visitd.sqlite"
    ledger_retention_days: float = 90.0
    metrics_host: str = "127.0.0.1"
    metrics_port: int = 9090
    tick_seconds: float = 5.0
    frigate_version: str = "0.17.2"
    log_level: str = "INFO"

    def camera_specs(self) -> Dict[str, CameraSpec]:
        """Camera name -> CameraSpec."""
        return {name: cam.spec() for name, cam in self.cameras.items()}


def _get(raw: Mapping[str, Any], key: str, default: Any) -> Any:
    """Read a key with a default, treating None as unset."""
    value = raw.get(key)
    return default if value is None else value


def _str_list(raw: Any, where: str) -> Tuple[str, ...]:
    """Validate a list of strings."""
    if raw is None:
        return ()
    if not isinstance(raw, list) or not all(isinstance(x, str) and x for x in raw):
        raise ConfigError(f"{where} must be a list of non-empty strings")
    return tuple(raw)


def build_config(raw: Mapping[str, Any], environ: Optional[Mapping[str, str]] = None) -> Config:
    """Build a validated Config from a parsed YAML mapping plus the environment."""
    env = dict(os.environ if environ is None else environ)
    mqtt_raw = _get(raw, "mqtt", {})
    backend_raw = _get(raw, "backend", {})
    visit_raw = _get(raw, "visit", {})
    plate_raw = _get(raw, "plate", {})
    ledger_raw = _get(raw, "ledger", {})
    metrics_raw = _get(raw, "metrics", {})
    frigate_raw = _get(raw, "frigate", {})

    mqtt = MqttConfig(
        host=str(_get(mqtt_raw, "host", "mqtt")),
        port=int(_get(mqtt_raw, "port", 1883)),
        username=env.get("MQTT_USERNAME") or _get(mqtt_raw, "username", None),
        password=env.get("MQTT_PASSWORD") or _get(mqtt_raw, "password", None),
        topic_prefix=str(_get(mqtt_raw, "topicPrefix", "frigate")),
        client_id=str(_get(mqtt_raw, "clientId", "visitd")),
        keepalive=int(_get(mqtt_raw, "keepalive", 60)),
        queue_max=int(_get(mqtt_raw, "queueMax", 10000)),
    )
    sync_key_env = str(_get(backend_raw, "syncKeyEnv", "STATENOUR_SYNC_KEY"))
    backend = BackendConfig(
        base_url=str(_get(backend_raw, "baseUrl", "https://bdnick.info")).rstrip("/"),
        sync_key=env.get(sync_key_env) or None,
        timeout_seconds=float(_get(backend_raw, "timeoutSeconds", 8.0)),
        heartbeat_seconds=float(_get(backend_raw, "heartbeatSeconds", 60.0)),
        retry_min_seconds=float(_get(backend_raw, "retryMinSeconds", 1.0)),
        retry_max_seconds=float(_get(backend_raw, "retryMaxSeconds", 60.0)),
        outbox_max_depth=int(_get(backend_raw, "outboxMaxDepth", 5000)),
        outbox_max_attempts=int(_get(backend_raw, "outboxMaxAttempts", 40)),
    )

    cameras_raw = _get(raw, "cameras", {})
    if not isinstance(cameras_raw, Mapping) or not cameras_raw:
        raise ConfigError("cameras: at least one camera is required")
    cameras: Dict[str, CameraConfig] = {}
    for name, cam in cameras_raw.items():
        if not isinstance(cam, Mapping):
            raise ConfigError(f"cameras.{name} must be a mapping")
        device = cam.get("cloudDeviceId")
        if not isinstance(device, str) or not device:
            raise ConfigError(f"cameras.{name}.cloudDeviceId is required")
        arrival = _str_list(cam.get("arrivalZones"), f"cameras.{name}.arrivalZones")
        bays = _str_list(cam.get("bayZones"), f"cameras.{name}.bayZones")
        if not arrival and not bays:
            raise ConfigError(f"cameras.{name} needs arrivalZones or bayZones")
        zone_names = _get(cam, "zoneNames", {})
        if not isinstance(zone_names, Mapping):
            raise ConfigError(f"cameras.{name}.zoneNames must be a mapping")
        cameras[str(name)] = CameraConfig(
            name=str(name),
            cloud_device_id=device,
            display_name=str(_get(cam, "displayName", str(name))),
            arrival_zones=arrival,
            bay_zones=bays,
            zone_names={str(k): str(v) for k, v in zone_names.items()},
        )

    links: List[TopologyLink] = []
    for i, link in enumerate(_get(raw, "topology", []) or []):
        if not isinstance(link, Mapping) or "from" not in link or "to" not in link:
            raise ConfigError(f"topology[{i}] needs from and to")
        if link["from"] not in cameras or link["to"] not in cameras:
            raise ConfigError(f"topology[{i}] references an unknown camera")
        links.append(
            TopologyLink(
                from_camera=str(link["from"]),
                to_camera=str(link["to"]),
                min_seconds=float(_get(link, "minSeconds", 1.0)),
                max_seconds=float(_get(link, "maxSeconds", 90.0)),
            )
        )

    policy = VisitPolicy(
        candidate_seconds=float(_get(visit_raw, "candidateSeconds", 10.0)),
        confirm_seconds=float(_get(visit_raw, "confirmSeconds", 45.0)),
        stationary_confirm_seconds=float(_get(visit_raw, "stationaryConfirmSeconds", 20.0)),
        leave_grace_seconds=float(_get(visit_raw, "leaveGraceSeconds", 20.0)),
        split_track_seconds=float(_get(visit_raw, "splitTrackSeconds", 10.0)),
        split_track_iou=float(_get(visit_raw, "splitTrackIou", 0.5)),
        plate_reattach_minutes=float(_get(plate_raw, "reattachMinutes", 30.0)),
        plate_confirm_score=float(_get(plate_raw, "confirmScore", 0.9)),
        plate_candidate_score=float(_get(plate_raw, "candidateScore", 0.7)),
        plate_single_read_confirm_score=float(_get(plate_raw, "singleReadConfirmScore", 0.95)),
        max_sighting_seconds=float(_get(visit_raw, "maxSightingSeconds", 43200.0)),
        topology=tuple(links),
    )
    for name, value in (("candidateSeconds", policy.candidate_seconds), ("confirmSeconds", policy.confirm_seconds)):
        if value < 0:
            raise ConfigError(f"visit.{name} must be >= 0")
    if policy.confirm_seconds < policy.candidate_seconds:
        raise ConfigError("visit.confirmSeconds must be >= visit.candidateSeconds")

    return Config(
        mqtt=mqtt,
        backend=backend,
        cameras=cameras,
        policy=policy,
        ledger_path=env.get("VISITD_LEDGER") or str(_get(ledger_raw, "path", "./data/visitd.sqlite")),
        ledger_retention_days=float(_get(ledger_raw, "retentionDays", 90.0)),
        metrics_host=env.get("VISITD_METRICS_HOST") or str(_get(metrics_raw, "host", "127.0.0.1")),
        metrics_port=int(_get(metrics_raw, "port", 9090)),
        tick_seconds=float(_get(raw, "tickSeconds", 5.0)),
        frigate_version=str(_get(frigate_raw, "version", "0.17.2")),
        log_level=str(_get(raw, "logLevel", "INFO")).upper(),
    )


def load_config(path: str) -> Config:
    """Read a YAML file and build the Config (PyYAML is only imported here)."""
    import yaml  # local import keeps the pure modules importable without PyYAML

    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    if not isinstance(raw, Mapping):
        raise ConfigError(f"{path}: top level must be a mapping")
    return build_config(raw)
