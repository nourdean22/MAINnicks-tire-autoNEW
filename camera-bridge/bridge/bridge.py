#!/usr/bin/env python3
import os
import sys
import time
import yaml
import json
import logging
import threading
import requests
import paho.mqtt.client as mqtt
from pathlib import Path
from dotenv import load_dotenv

# Import helper modules
from storage import StorageManager
from cleanup import StorageCleanup
from client import StatenourClient
from dedupe import EventDeduplicator
from plate_reader import get_plate_reader

# Setup structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("camera-bridge")

class CameraBridgeApp:
    def __init__(self, config_path: str):
        self.config_path = config_path
        self.config = {}
        self.load_config()
        
        # Initialize components
        self.storage = StorageManager(self.config.get("storage", {}))
        self.cleanup = StorageCleanup(self.storage, self.config.get("storage", {}))
        self.client = StatenourClient(self.config.get("backend", {}))
        self.dedupe = EventDeduplicator(self.config.get("detection", {}))
        self.plate_reader = get_plate_reader(self.config.get("plateCapture", {}))
        
        # State variables
        self.mqtt_connected = False
        self.dry_run = "--dry-run" in sys.argv
        
        # Start background helper threads
        self.stop_event = threading.Event()
        self.background_thread = threading.Thread(target=self._run_periodic_tasks, daemon=True)
        
    def load_config(self):
        try:
            with open(self.config_path, "r") as f:
                self.config = yaml.safe_load(f)
            logger.info("Configuration loaded successfully")
        except Exception as e:
            logger.critical(f"Failed to load configuration from {self.config_path}: {e}")
            sys.exit(1)

    def start(self):
        logger.info("Starting Statenour Camera Bridge...")
        if self.dry_run:
            logger.info("DRY-RUN mode active. Events will be logged but not uploaded.")

        # Start periodic thread
        self.background_thread.start()

        # Connect to MQTT
        mqtt_config = self.config.get("mqtt", {})
        client = mqtt.Client()
        client.on_connect = self.on_mqtt_connect
        client.on_message = self.on_mqtt_message
        
        broker_host = mqtt_config.get("host", "localhost")
        broker_port = mqtt_config.get("port", 1883)
        
        logger.info(f"Connecting to MQTT broker at {broker_host}:{broker_port}...")
        
        while not self.stop_event.is_set():
            try:
                client.connect(broker_host, broker_port, 60)
                break
            except Exception as e:
                logger.error(f"MQTT connection failed: {e}. Retrying in 5 seconds...")
                time.sleep(5)
                
        # Start MQTT event loop
        try:
            client.loop_forever()
        except KeyboardInterrupt:
            logger.info("Shutting down cleanly...")
            self.stop_event.set()
            client.disconnect()

    def on_mqtt_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.mqtt_connected = True
            logger.info("Connected to MQTT broker successfully")
            # Subscribe to the configured topic
            topic = self.config.get("mqtt", {}).get("topic", "frigate/events")
            client.subscribe(topic)
            logger.info(f"Subscribed to topic: {topic}")
            self.client.send_heartbeat("ONLINE", dry_run=self.dry_run)
        else:
            logger.error(f"MQTT connection failed with code {rc}")

    def on_mqtt_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
        except Exception as e:
            logger.error(f"Failed to parse MQTT message payload: {e}")
            return

        # Deduplicate event
        should_process, state, dwell = self.dedupe.process_event(payload)
        if not should_process:
            return

        after = payload.get("after", {})
        event_id = after.get("id")
        camera_id = after.get("camera", "unknown")
        label = after.get("label", "vehicle")
        confidence = after.get("confidence", 0.0)
        
        logger.info(f"Processing event {event_id} ({state}) from {camera_id}. Dwell: {dwell:.1f}s")

        # 1. Fetch snapshot from Frigate HTTP API (if snapshots are enabled)
        snapshot_bytes = None
        if self.config.get("storage", {}).get("enabled", True):
            snapshot_bytes = self._fetch_frigate_snapshot(event_id)
            if snapshot_bytes:
                self.storage.save_snapshot(event_id, snapshot_bytes)

        # 2. Run Plate Capture OCR (if enabled and state is CONFIRMED_ARRIVAL)
        plate_data = {"status": "NONE", "confidence": 0.0, "provider": "disabled"}
        if state == "CONFIRMED_ARRIVAL" and self.config.get("plateCapture", {}).get("enabled", True):
            if snapshot_bytes:
                # Perform OCR on snapshot
                plate_result = self.plate_reader.read_plate(snapshot_bytes)
                if plate_result:
                    plate_data = plate_result
                    logger.info(f"Plate Resolved: {plate_data.get('text')} ({plate_data.get('status')})")
                    
                    # Crop the plate crop region if ALPR returned bounding boxes (optional helper)
                    # For simplicity, we can save a copy of the cropped region if local OCR is used
            else:
                logger.warning("No snapshot available for ALPR processing")

        # 3. Assemble Target Ingest Contract
        normalized_event = {
            "event": "vehicle_detected",
            "source": "frigate",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "data": {
                "cameraId": camera_id,
                "cameraName": self.config.get("camera", {}).get("name", camera_id.replace("_", " ").title()),
                "zone": after.get("current_zones", ["front_lot"])[0],
                "zoneName": "Front Lot",
                "state": state,
                "priority": "normal" if state != "CONFIRMED_ARRIVAL" else "high",
                "label": label,
                "confidence": float(confidence),
                "dwellSeconds": float(round(dwell, 1)),
                "trackId": event_id,
                "plate": plate_data,
                "metadata": {
                    "direction": "entering" if state != "LEFT" else "leaving",
                    "frameWidth": after.get("area", 0) # proxy for pixel size
                }
            }
        }

        # 4. Upload to Statenour-OS Backend
        self.client.send_event(normalized_event, dry_run=self.dry_run)

    def _fetch_frigate_snapshot(self, event_id: str) -> bytes:
        """Fetches snapshot image bytes from Frigate Web API."""
        frigate_host = self.config.get("mqtt", {}).get("host", "localhost")
        url = f"http://{frigate_host}:5000/api/events/{event_id}/snapshot.jpg"
        
        try:
            logger.debug(f"Fetching snapshot from {url}")
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                return resp.content
            else:
                logger.error(f"Frigate snapshot API returned status {resp.status_code}")
        except Exception as e:
            logger.error(f"Failed to fetch snapshot from Frigate: {e}")
        return None

    def _run_periodic_tasks(self):
        """Background thread executing heartbeats, retry queue flushes, and disk cleanups."""
        last_cleanup = 0
        last_heartbeat = 0
        cleanup_interval = self.config.get("storage", {}).get("cleanupEveryMinutes", 30) * 60

        while not self.stop_event.is_set():
            now = time.time()

            # 1. Heartbeat every 60 seconds
            if now - last_heartbeat >= 60:
                self.client.send_heartbeat("ONLINE", dry_run=self.dry_run)
                last_heartbeat = now

            # 2. Storage cleanup
            if now - last_cleanup >= cleanup_interval:
                logger.info("Executing periodic disk storage cleanup...")
                self.cleanup.enforce_retention()
                self.cleanup.enforce_size_limit()
                last_cleanup = now

            # Sleep short to react to shutdown events quickly
            self.stop_event.wait(5)

if __name__ == "__main__":
    load_dotenv()
    
    script_dir = Path(__file__).parent.resolve()
    config_file = script_dir / "config.yaml"
    if not config_file.exists():
        config_file = script_dir / "config.example.yaml"
        logger.warning(f"config.yaml not found! Using template {config_file}.")

    app = CameraBridgeApp(str(config_file))
    app.start()
