import os
import shutil
import logging
from pathlib import Path

logger = logging.getLogger("camera-bridge.storage")

class StorageManager:
    def __init__(self, config):
        self.config = config
        self.enabled = config.get("enabled", True)
        self.base_path = Path(config.get("storagePath", "./storage")).resolve()
        self.snapshots_path = self.base_path / "snapshots"
        self.crops_path = self.base_path / "crops"
        
        if self.enabled:
            self._init_dirs()

    def _init_dirs(self):
        try:
            self.snapshots_path.mkdir(parents=True, exist_ok=True)
            self.crops_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Storage paths initialized at {self.base_path}")
        except Exception as e:
            logger.error(f"Failed to create storage directories: {e}")
            self.enabled = False

    def save_snapshot(self, event_id: str, image_bytes: bytes) -> str:
        """Saves snapshot to disk and returns absolute path."""
        if not self.enabled or not image_bytes:
            return ""
        try:
            filepath = self.snapshots_path / f"{event_id}.jpg"
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            logger.debug(f"Saved snapshot to {filepath}")
            return str(filepath)
        except Exception as e:
            logger.error(f"Failed to save snapshot for event {event_id}: {e}")
            return ""

    def save_plate_crop(self, event_id: str, image_bytes: bytes) -> str:
        """Saves plate crop to disk and returns absolute path."""
        if not self.enabled or not image_bytes:
            return ""
        try:
            filepath = self.crops_path / f"{event_id}_plate.jpg"
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            logger.debug(f"Saved plate crop to {filepath}")
            return str(filepath)
        except Exception as e:
            logger.error(f"Failed to save plate crop for event {event_id}: {e}")
            return ""

    def get_total_size_gb(self) -> float:
        """Calculate total directory size in Gigabytes."""
        if not self.base_path.exists():
            return 0.0
        total_size = 0
        for dirpath, _, filenames in os.walk(self.base_path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                # skip symbolic links
                if not os.path.islink(fp):
                    total_size += os.path.getsize(fp)
        return total_size / (1024 * 1024 * 1024)
