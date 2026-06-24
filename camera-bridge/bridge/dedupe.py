import time
import logging

logger = logging.getLogger("camera-bridge.dedupe")

class VehicleTrack:
    def __init__(self, track_id: str, camera_id: str, label: str):
        self.track_id = track_id
        self.camera_id = camera_id
        self.label = label
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.dwell_seconds = 0.0
        self.states_alerted = set() # track which states we already alerted on (e.g. ENTERED_ZONE)
        self.last_posted_payload = None

    def update(self, zone_presence: bool) -> float:
        self.last_seen = time.time()
        self.dwell_seconds = self.last_seen - self.first_seen
        return self.dwell_seconds

class EventDeduplicator:
    def __init__(self, config):
        self.config = config
        self.min_dwell = config.get("minDwellSeconds", 2)
        self.cooldown_seconds = config.get("cooldownSeconds", 120)
        
        # Track storage: key = track_id
        self.tracks = {}
        # Cooldown storage: key = (camera_id, zone, label) -> last_alert_time
        self.cooldowns = {}
        
        self.last_cleanup = time.time()

    def process_event(self, event_data: dict) -> tuple[bool, str, float]:
        """
        Deduplicates incoming raw Frigate events.
        Returns:
            (should_process: bool, target_state: str, current_dwell: float)
        """
        # Periodically clean up stale tracks
        if time.time() - self.last_cleanup > 300: # every 5 minutes
            self._cleanup_stale_tracks()

        # Parse Frigate message elements
        # Frigate MQTT event structure: https://docs.frigate.video/integrations/mqtt
        event_type = event_data.get("type", "update") # new, update, end
        before = event_data.get("before", {})
        after = event_data.get("after", {})
        
        track_id = after.get("id")
        camera_id = after.get("camera")
        label = after.get("label")
        
        if not track_id or not camera_id or not label:
            return False, "UNKNOWN", 0.0

        # 1. Update or create Track entry
        if track_id not in self.tracks:
            self.tracks[track_id] = VehicleTrack(track_id, camera_id, label)
            
        track = self.tracks[track_id]
        
        # Check if currently inside configured zones
        configured_zones = self.config.get("zones", [])
        current_zones = after.get("current_zones", [])
        active_zones = [z for z in current_zones if z in configured_zones]
        in_zone = len(active_zones) > 0
        
        dwell = track.update(in_zone)
        
        # 2. Check if track ended
        if event_type == "end":
            logger.info(f"Track {track_id} ended. Total dwell: {dwell:.1f}s")
            # Mark as LEFT if we previously sent alerts
            was_alerted = len(track.states_alerted) > 0
            # Remove from active tracks
            if track_id in self.tracks:
                del self.tracks[track_id]
            return was_alerted, "LEFT", dwell

        # If not in zone, do not trigger alerts
        if not in_zone:
            return False, "DETECTED", dwell

        # 3. Determine state based on dwell
        target_state = "ENTERED_ZONE"
        if dwell >= self.min_dwell:
            target_state = "CONFIRMED_ARRIVAL"

        # 4. Check if we already alerted on this state for this track
        if target_state in track.states_alerted:
            # We already sent an alert for this track state, deduplicate!
            return False, target_state, dwell

        # 5. Cooldown check by Camera + Zone + Label (only for new arrivals)
        primary_zone = active_zones[0]
        cooldown_key = (camera_id, primary_zone, label)
        last_alert = self.cooldowns.get(cooldown_key, 0.0)
        
        is_in_cooldown = (time.time() - last_alert) < self.cooldown_seconds
        
        if is_in_cooldown and target_state == "ENTERED_ZONE":
            logger.debug(f"Event throttled due to active cooldown on {camera_id}/{primary_zone}/{label}")
            return False, target_state, dwell

        # Event is valid and should be sent!
        track.states_alerted.add(target_state)
        
        # Record cooldown timestamp if we are confirming arrival or alerting
        if target_state == "CONFIRMED_ARRIVAL":
            self.cooldowns[cooldown_key] = time.time()
            
        return True, target_state, dwell

    def _cleanup_stale_tracks(self):
        """Purge tracks that haven't been updated in 15 minutes."""
        now = time.time()
        stale_cutoff = now - 900 # 15 minutes
        
        stale_ids = [tid for tid, track in self.tracks.items() if track.last_seen < stale_cutoff]
        for tid in stale_ids:
            del self.tracks[tid]
            
        # Also clean up expired cooldowns
        expired_cooldown_keys = [
            key for key, last_time in self.cooldowns.items() 
            if (now - last_time) >= self.cooldown_seconds
        ]
        for key in expired_cooldown_keys:
            del self.cooldowns[key]
            
        self.last_cleanup = now
        if stale_ids or expired_cooldown_keys:
            logger.info(f"Cleaned up {len(stale_ids)} stale tracks and {len(expired_cooldown_keys)} expired cooldown keys.")
