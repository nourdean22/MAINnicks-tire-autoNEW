"""Config building: defaults, env precedence, validation errors."""
from __future__ import annotations

import unittest

import helpers  # noqa: F401  (sys.path)

from visitd.config import ConfigError, build_config

MINIMAL = {"cameras": {"lot": {"cloudDeviceId": "v380-shopinside", "arrivalZones": ["front_lot"]}}}


class BuildConfigTest(unittest.TestCase):
    def test_defaults(self) -> None:
        cfg = build_config(MINIMAL, environ={})
        self.assertEqual(cfg.mqtt.host, "mqtt")
        self.assertIsNone(cfg.mqtt.password)
        self.assertEqual(cfg.backend.base_url, "https://bdnick.info")
        self.assertIsNone(cfg.backend.sync_key)
        self.assertEqual(cfg.backend.outbox_max_depth, 5000)
        self.assertEqual(cfg.policy.candidate_seconds, 10.0)
        self.assertEqual(cfg.policy.confirm_seconds, 45.0)
        self.assertEqual(cfg.policy.stationary_confirm_seconds, 20.0)
        self.assertEqual(cfg.policy.leave_grace_seconds, 20.0)
        self.assertEqual(cfg.policy.topology, ())
        self.assertEqual(cfg.tick_seconds, 5.0)
        self.assertEqual(cfg.metrics_host, "127.0.0.1")
        self.assertEqual(cfg.metrics_port, 9090)
        spec = cfg.camera_specs()["lot"]
        self.assertEqual(spec.arrival_zones, frozenset({"front_lot"}))
        self.assertEqual(cfg.cameras["lot"].display_name, "lot")

    def test_env_overrides_yaml_secrets_and_ledger(self) -> None:
        raw = dict(MINIMAL, mqtt={"username": "yaml-user", "password": "yaml-pass"}, backend={"baseUrl": "https://x.test/"})
        env = {"MQTT_USERNAME": "visitd", "MQTT_PASSWORD": "pw", "STATENOUR_SYNC_KEY": "k", "VISITD_LEDGER": "/data/x.sqlite"}
        cfg = build_config(raw, environ=env)
        self.assertEqual((cfg.mqtt.username, cfg.mqtt.password), ("visitd", "pw"))
        self.assertEqual(cfg.backend.sync_key, "k")
        self.assertEqual(cfg.backend.base_url, "https://x.test")
        self.assertEqual(cfg.ledger_path, "/data/x.sqlite")

    def test_env_metrics_host_overrides_the_file(self) -> None:
        raw = dict(MINIMAL, metrics={"host": "127.0.0.1", "port": 9090})
        self.assertEqual(build_config(raw, environ={}).metrics_host, "127.0.0.1")  # host runs keep loopback
        self.assertEqual(build_config(raw, environ={"VISITD_METRICS_HOST": "0.0.0.0"}).metrics_host, "0.0.0.0")  # compose
        self.assertEqual(build_config(raw, environ={"VISITD_METRICS_HOST": ""}).metrics_host, "127.0.0.1")  # empty = unset

    def test_topology_and_zone_names(self) -> None:
        raw = {
            "cameras": {
                "lot": {"cloudDeviceId": "a", "arrivalZones": ["front_lot"], "zoneNames": {"front_lot": "Front Lot"}},
                "sign": {"cloudDeviceId": "b", "arrivalZones": ["bay_entrance"]},
            },
            "topology": [{"from": "sign", "to": "lot", "minSeconds": 2, "maxSeconds": 60}],
        }
        cfg = build_config(raw, environ={})
        self.assertEqual(len(cfg.policy.topology), 1)
        self.assertEqual(cfg.policy.topology[0].to_camera, "lot")
        self.assertEqual(cfg.policy.topology[0].max_seconds, 60.0)
        self.assertEqual(cfg.cameras["lot"].zone_names, {"front_lot": "Front Lot"})

    def test_validation_errors(self) -> None:
        cases = [
            {},
            {"cameras": {}},
            {"cameras": {"lot": {"arrivalZones": ["front_lot"]}}},
            {"cameras": {"lot": {"cloudDeviceId": "a"}}},
            {"cameras": {"lot": {"cloudDeviceId": "a", "arrivalZones": "front_lot"}}},
            dict(MINIMAL, topology=[{"from": "nope", "to": "lot"}]),
            dict(MINIMAL, visit={"candidateSeconds": 50, "confirmSeconds": 45}),
        ]
        for raw in cases:
            with self.subTest(raw=raw):
                with self.assertRaises(ConfigError):
                    build_config(raw, environ={})


if __name__ == "__main__":
    unittest.main()
