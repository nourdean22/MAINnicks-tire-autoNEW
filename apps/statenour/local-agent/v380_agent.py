#!/usr/bin/env python3
"""
Statenour OS — V380 Camera Agent
Monitors V380 cameras, preferring direct LAN RTSP over cloud relay.

Connection priority:
  1. LAN RTSP (port 554) — direct, fast, no cloud dependency
  2. MacroVideo cloud API — fallback when not on shop network

Camera registry (from V380.ini):
  SHOPINSIDE: ID 119923618, user XF0a1B5Uwx
  SHOPSIGN:   ID 119972829, user 119972829

LAN discovery result (2026-03-26):
  Confirmed camera IPs on shop WiFi (192.168.0.0/24):
    192.168.0.154 — MAC 1c:4e:a2:c2:ce:37 (Shenzhen Bilian / V380) = SHOPINSIDE
    192.168.0.155 — MAC 1c:4e:a2:c2:f0:6d (Shenzhen Bilian / V380) = SHOPSIGN

  These cameras do NOT expose port 554 — they use P2P-only mode.
  RTSP must be enabled via V380 Pro app: Settings → Remote Settings → RTSP.
  Until RTSP is enabled, agent uses ping liveness + cloud API for status.

  Other devices on subnet:
    192.168.0.1:80   = router
    192.168.0.156    = unknown (MAC 00:1d:a9, Trendnet?)
    192.168.0.157    = unknown (MAC 00:23:24)
    192.168.0.159    = nginx device (Eufy HomeBase likely)

RTSP paths to try once enabled:
  rtsp://<ip>:554/live/ch00_0          (primary)
  rtsp://<ip>:554/stream0              (alt)
  rtsp://admin:@<ip>:554/live/ch00_0   (with empty password)
"""

import os
import socket
import ipaddress
import subprocess
import concurrent.futures
import logging
import requests
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

log = logging.getLogger("v380-agent")

API_URL = os.getenv("STATENOUR_API_URL", "https://bdnick.info")
SYNC_KEY = os.getenv("STATENOUR_SYNC_KEY", "")

# Override LAN IPs via env (e.g. V380_LAN_IPS=192.168.1.100,192.168.1.101)
_LAN_IPS_ENV = os.getenv("V380_LAN_IPS", "")

# V380 camera registry — extracted from V380.ini
V380_CAMERAS = [
    {
        "platformDeviceId": "v380-shopinside",
        "cloudId": "119923618",
        "cloudUser": "XF0a1B5Uwx",
        "name": "Shop Inside Camera",
        "location": "shop",
    },
    {
        "platformDeviceId": "v380-shopsign",
        "cloudId": "119972829",
        "cloudUser": "119972829",
        "name": "Shop Sign Camera",
        "location": "shop",
    },
]

# V380 Cloud API (MacroVideo) — blocked by Cloudflare, kept for reference
V380_CLOUD_API = "https://ipc-api.macrovideo.com"
V380_ACCOUNT_ID = "90142912"

# MacroVideo PPCS relay servers (captured from V380 app network connections)
# These are the actual P2P relay IPs the cameras connect through.
# If TCP to port 8800 succeeds → cloud relay is up → cameras likely online.
PPCS_SERVERS = [
    ("172.238.49.103", 8800),
    ("114.55.111.213", 8883),  # MQTT broker
]

# Confirmed camera IPs from ARP scan on shop WiFi (2026-03-26)
# MAC prefix 1c:4e:a2 = Shenzhen Bilian Electronics (V380 WiFi chip)
# RTSP not enabled — cameras use P2P-only mode. Enable via V380 Pro app.
KNOWN_CAMERA_IPS = {
    "v380-shopinside": "192.168.0.154",
    "v380-shopsign":   "192.168.0.155",
}

# Cache discovered LAN IPs for the lifetime of this process
_discovered_lan_ips: list[str] = []


# ---------------------------------------------------------------------------
# LAN Discovery
# ---------------------------------------------------------------------------

def scan_for_rtsp(subnet: str = None, timeout: float = 0.35) -> list[str]:
    """
    Scan the local subnet for devices with RTSP port 554 open.
    Returns a list of IPs that responded.

    Runs a threaded scan across all 254 hosts; typical runtime < 3s.
    """
    if subnet is None:
        # Find the first private LAN IP that isn't Tailscale (skip 100.x, 127.x)
        local_ip = None
        for ip in _all_local_ips():
            if not ip.startswith("100.") and not ip.startswith("127.") and not ip.startswith("169."):
                local_ip = ip
                break
        if not local_ip:
            return []
        parts = local_ip.rsplit(".", 1)
        subnet = parts[0] + ".0/24"

    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return []

    found = []

    def _check(ip: str) -> str | None:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            r = s.connect_ex((ip, 554))
            s.close()
            return ip if r == 0 else None
        except Exception:
            return None

    hosts = [str(h) for h in network.hosts()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as ex:
        for result in ex.map(_check, hosts):
            if result:
                found.append(result)

    log.info("LAN RTSP scan of %s: found %d device(s) with port 554 open: %s",
             subnet, len(found), found or "none")
    return found


def get_lan_ips(force_scan: bool = False) -> list[str]:
    """
    Return LAN IPs for V380 cameras.
    Priority: env override → cached → fresh scan.
    """
    global _discovered_lan_ips

    if _LAN_IPS_ENV:
        return [ip.strip() for ip in _LAN_IPS_ENV.split(",") if ip.strip()]

    if _discovered_lan_ips and not force_scan:
        return _discovered_lan_ips

    _discovered_lan_ips = scan_for_rtsp()
    return _discovered_lan_ips


# ---------------------------------------------------------------------------
# RTSP / LAN check
# ---------------------------------------------------------------------------

def _check_rtsp_alive(ip: str) -> bool:
    """TCP check: is port 554 open? (requires RTSP enabled on camera)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        r = s.connect_ex((ip, 554))
        s.close()
        return r == 0
    except Exception:
        return False


def _ping_alive(ip: str) -> bool:
    """ICMP ping check — confirms camera is powered on and reachable on LAN."""
    try:
        r = subprocess.run(
            ["ping", "-n", "1", "-w", "800", ip],
            capture_output=True, text=True, timeout=2,
        )
        return "TTL=" in r.stdout
    except Exception:
        return False


def _all_local_ips() -> list[str]:
    """Return all non-loopback IPv4 addresses across all interfaces."""
    ips = []
    try:
        # enumerate all addresses the OS knows about
        for _, _, _, _, sockaddr in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = sockaddr[0]
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    # Also try the default-route method as a fallback
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return list(set(ips))


def _on_shop_subnet() -> bool:
    """Returns True if any local interface is on the 192.168.0.0/24 shop network."""
    return any(ip.startswith("192.168.0.") for ip in _all_local_ips())


# ---------------------------------------------------------------------------
# Cloud fallback
# ---------------------------------------------------------------------------

def _check_ppcs_reachable() -> bool:
    """
    Check if the MacroVideo PPCS relay is reachable.
    The V380 app connects to these servers via TCP for P2P camera sessions.
    If at least one is reachable, the cloud relay is up and cameras may be online.
    """
    for host, port in PPCS_SERVERS:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3)
            r = s.connect_ex((host, port))
            s.close()
            if r == 0:
                return True
        except Exception:
            pass
    return False


def _check_v380_cloud(cloud_id: str) -> bool:
    """
    Check camera online status.
    MacroVideo HTTP API is Cloudflare-blocked — falls back to PPCS relay check.
    If PPCS relay is reachable, assume registered cameras are ONLINE.
    """
    # Try HTTP API first (may work in future or from different network)
    try:
        url = f"{V380_CLOUD_API}/device/status"
        resp = requests.post(url, json={
            "deviceId": cloud_id,
            "accountId": V380_ACCOUNT_ID,
        }, timeout=4)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("online", False) or data.get("status") == 1
    except Exception:
        pass

    # Fall back to PPCS connectivity — if relay is up, camera is likely online
    return _check_ppcs_reachable()


# ---------------------------------------------------------------------------
# Main poll
# ---------------------------------------------------------------------------

def poll_v380_status() -> list[dict]:
    """
    Poll V380 cameras. Priority:
      1. LAN RTSP (port 554 open) — direct stream
      2. LAN ping on known IPs — confirms online, no stream
      3. MacroVideo cloud API — status only, no stream
    """
    on_shop = _on_shop_subnet()
    lan_ips = get_lan_ips()  # RTSP scan result

    devices = []
    for cam in V380_CAMERAS:
        cam_id = cam["platformDeviceId"]
        known_ip = KNOWN_CAMERA_IPS.get(cam_id)

        rtsp_ip = None
        lan_ip = None
        connection_type = "P2P_CLOUD"
        online = False
        rtsp_url = None

        if lan_ips:
            # RTSP is available — use direct stream
            idx = list(cam["platformDeviceId"] for cam in V380_CAMERAS).index(cam_id)
            rtsp_ip = lan_ips[idx % len(lan_ips)]
            online = _check_rtsp_alive(rtsp_ip)
            lan_ip = rtsp_ip
            rtsp_url = f"rtsp://{rtsp_ip}:554/live/ch00_0"
            connection_type = "LAN_RTSP"
        elif on_shop and known_ip:
            # On shop network, known IP, but RTSP not enabled — use ping
            online = _ping_alive(known_ip)
            lan_ip = known_ip
            connection_type = "LAN_PING"
            log.debug("V380 %s ping %s: %s", cam_id, known_ip,
                      "alive" if online else "no response")
        else:
            # Off-site — use cloud relay
            online = _check_v380_cloud(cam["cloudId"])

        devices.append({
            "platformDeviceId": cam["platformDeviceId"],
            "name": cam["name"],
            "platform": "V380",
            "deviceType": "CAMERA",
            "location": cam["location"],
            "status": "ONLINE" if online else "UNKNOWN",
            "currentState": {
                "cloud_id": cam["cloudId"],
                "cloud_user": cam["cloudUser"],
                "connection_type": connection_type,
                "lan_ip": lan_ip,
                "rtsp_url": rtsp_url,
                "last_check": datetime.utcnow().isoformat(),
            },
            "metadata": {
                "cloud_id": cam["cloudId"],
                "account_id": V380_ACCOUNT_ID,
                "platform_type": "MacroVideo",
            },
        })

    return devices


def sync_v380_devices() -> int:
    """Poll V380 cameras and sync to statenour-os."""
    devices = poll_v380_status()
    if not devices:
        return 0

    url = f"{API_URL}/api/sync/nour-os"
    headers = {
        "Content-Type": "application/json",
        "x-sync-key": SYNC_KEY,
    }
    payload = {
        "module": "devices",
        "data": {"devices": devices},
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code == 200:
            count = resp.json().get("data", {}).get("result", {}).get("synced", 0)
            log.info("Synced %d V380 cameras", count)
            return count
        else:
            log.error("V380 sync failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.error("V380 sync error: %s", e)
    return 0


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    if "--scan" in sys.argv:
        ips = scan_for_rtsp()
        print("Found:", ips or "No RTSP devices on LAN")
    else:
        sync_v380_devices()
