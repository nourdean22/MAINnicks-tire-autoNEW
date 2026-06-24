import os
import time
import logging
from pathlib import Path
from storage import StorageManager

logger = logging.getLogger("camera-bridge.cleanup")

class StorageCleanup:
    def __init__(self, storage_manager: StorageManager, config):
        self.storage_manager = storage_manager
        self.config = config
        self.max_gb = config.get("maxLocalGb", 5)
        self.snapshot_days = config.get("snapshotRetentionDays", 7)
        self.crop_days = config.get("plateCropRetentionDays", 14)

    def enforce_retention(self):
        """Purge old snapshots and crops based on age."""
        if not self.storage_manager.enabled:
            return
        
        now = time.time()
        snapshot_cutoff = now - (self.snapshot_days * 86400)
        crop_cutoff = now - (self.crop_days * 86400)

        # 1. Clean snapshots
        self._purge_dir_by_age(self.storage_manager.snapshots_path, snapshot_cutoff)
        
        # 2. Clean crops
        self._purge_dir_by_age(self.storage_manager.crops_path, crop_cutoff)

    def enforce_size_limit(self):
        """Purge oldest files if storage size exceeds quota."""
        if not self.storage_manager.enabled:
            return
            
        current_gb = self.storage_manager.get_total_size_gb()
        if current_gb <= self.max_gb:
            logger.debug(f"Storage size is within limits: {current_gb:.3f} GB / {self.max_gb} GB")
            return
            
        logger.warning(f"Storage size exceeded quota: {current_gb:.3f} GB / {self.max_gb} GB. Starting purge...")
        
        # Gather all files with modified times
        all_files = []
        for folder in [self.storage_manager.snapshots_path, self.storage_manager.crops_path]:
            if folder.exists():
                for f in folder.iterdir():
                    if f.is_file():
                        all_files.append((f, f.stat().st_mtime))
                        
        # Sort files by modification time (oldest first)
        all_files.sort(key=lambda x: x[1])
        
        deleted_count = 0
        for f, _ in all_files:
            try:
                f.unlink()
                deleted_count += 1
                current_gb = self.storage_manager.get_total_size_gb()
                if current_gb <= (self.max_gb * 0.85): # target 85% of limit after purge
                    break
            except Exception as e:
                logger.error(f"Failed to delete {f}: {e}")
                
        logger.info(f"Purge complete. Deleted {deleted_count} file(s). New size: {current_gb:.3f} GB")

    def _purge_dir_by_age(self, directory: Path, cutoff_time: float):
        if not directory.exists():
            return
        deleted = 0
        for f in directory.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff_time:
                try:
                    f.unlink()
                    deleted += 1
                except Exception as e:
                    logger.error(f"Failed to delete {f}: {e}")
        if deleted > 0:
            logger.info(f"Cleaned {deleted} file(s) from {directory.name} due to age")
