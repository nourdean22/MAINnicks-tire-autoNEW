import os
import time
import json
import logging
import requests
from collections import deque
from dotenv import load_dotenv

logger = logging.getLogger("camera-bridge.client")

# Load environment variables
load_dotenv()

class StatenourClient:
    def __init__(self, config):
        self.config = config
        self.ingest_url = config.get("ingestUrl", "")
        self.auth_env_name = config.get("authEnv", "STATENOUR_SYNC_KEY")
        self.timeout = config.get("timeoutSeconds", 8)
        self.max_retries = config.get("retryAttempts", 3)
        self.max_pending_events = config.get("maxPendingEvents", 500)
        
        # In-memory queue to buffer events during network dropouts
        self.offline_queue = deque(maxlen=self.max_pending_events)
        
        # Load API key
        self.api_key = os.getenv(self.auth_env_name, "")
        if not self.api_key:
            logger.warning(f"Authentication key '{self.auth_env_name}' not found in environment!")

    def send_event(self, payload: dict, dry_run: bool = False) -> bool:
        """
        Sends event payload to backend.
        If send fails, buffers the event in a local retry queue.
        """
        if dry_run:
            logger.info(f"[DRY-RUN] Would post event: {json.dumps(payload, indent=2)}")
            return True

        if not self.ingest_url:
            logger.error("Backend ingestUrl is not configured! Event dropped.")
            return False

        headers = {
            "Content-Type": "application/json",
            "x-sync-key": self.api_key
        }

        # Process any previously queued offline events first
        self.flush_offline_queue()

        success = self._post_with_retry(self.ingest_url, payload, headers)
        
        if not success:
            logger.warning("Posting failed. Buffering event in local retry queue.")
            self.offline_queue.append(payload)
            
        return success

    def send_heartbeat(self, status: str = "ONLINE", dry_run: bool = False) -> bool:
        """Sends a liveness status update to backend devices endpoint."""
        if dry_run:
            logger.info(f"[DRY-RUN] Would send heartbeat: status={status}")
            return True

        if not self.ingest_url:
            return False
            
        # Parse device endpoint from ingest URL
        # e.g., https://bdnick.info/api/devices/v380-shopsign/events -> https://bdnick.info/api/devices/v380-shopsign
        device_url = self.ingest_url.replace("/events", "")
        
        headers = {
            "Content-Type": "application/json",
            "x-sync-key": self.api_key
        }
        
        payload = {
            "status": status,
            "lastSeenAt": new_utc_iso()
        }
        
        try:
            logger.debug(f"Sending heartbeat to {device_url}")
            resp = requests.patch(device_url, json=payload, headers=headers, timeout=self.timeout)
            return resp.status_code == 200
        except Exception as e:
            logger.debug(f"Failed to send heartbeat: {e}")
            return False

    def flush_offline_queue(self):
        """Attempts to clear cached offline events."""
        if not self.offline_queue:
            return
            
        logger.info(f"Offline queue contains {len(self.offline_queue)} events. Attempting sync...")
        headers = {
            "Content-Type": "application/json",
            "x-sync-key": self.api_key
        }
        
        while self.offline_queue:
            payload = self.offline_queue[0]
            # Add flag indicating this was a queued/delayed event
            if "data" in payload:
                payload["data"]["queuedEvent"] = True
                
            success = self._post_with_retry(self.ingest_url, payload, headers)
            if success:
                self.offline_queue.popleft()
                logger.info("Successfully flushed queued event to cloud.")
                time.sleep(0.5) # throttle flush speed
            else:
                logger.warning("Network still unavailable. Stopping flush.")
                break

    def _post_with_retry(self, url: str, payload: dict, headers: dict) -> bool:
        retries = 0
        backoff = 1.5
        
        while retries < self.max_retries:
            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
                if resp.status_code == 200 or resp.status_code == 201:
                    return True
                else:
                    logger.error(f"Backend returned status {resp.status_code}: {resp.text[:200]}")
                    if resp.status_code == 401:
                        # Auth key mismatch, no point retrying
                        break
            except Exception as e:
                logger.error(f"HTTP post exception on attempt {retries + 1}: {e}")
                
            retries += 1
            if retries < self.max_retries:
                logger.info(f"Retrying in {backoff} seconds...")
                time.sleep(backoff)
                backoff *= 2 # exponential backoff
                
        return False

def new_utc_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
