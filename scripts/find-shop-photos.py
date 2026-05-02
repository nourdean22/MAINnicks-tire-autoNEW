"""
Scan iCloud Photos for shots taken NEAR Nick's Tire & Auto.

Address: 17625 Euclid Ave, Cleveland OH
Coords:  41.5525118 N, -81.5571875 E

Strategy: walk every JPG/HEIC, read EXIF GPS, keep anything within
~150 meters of the shop AND in our shop-relevant date window.

Output: a manifest of candidate photos with full path, size,
dimensions, and date — so we can hand-pick the shop-quality shots.
"""

import os
import sys
import json
import math
from pathlib import Path
from datetime import datetime
from PIL import Image, ExifTags

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    print("[warn] pillow_heif not installed; HEIC files will be skipped", file=sys.stderr)

PHOTOS = Path("C:/Users/nourd/iCloudPhotos/Photos")
SHOP_LAT = 41.5525118
SHOP_LON = -81.5571875
RADIUS_METERS = 200  # generous — covers the lot + Euclid Ave approach

EXIF_GPS = next(k for k, v in ExifTags.TAGS.items() if v == "GPSInfo")
GPS_TAGS = {v: k for k, v in ExifTags.GPSTAGS.items()}


def dms_to_decimal(dms, ref):
    """EXIF GPS is degrees/minutes/seconds rationals; convert to signed decimal."""
    deg, minutes, sec = (float(x) for x in dms)
    val = deg + minutes / 60 + sec / 3600
    return -val if ref in ("S", "W") else val


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000  # earth radius in meters
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def extract_gps_and_date(path):
    """Returns (lat, lon, datetime) or None."""
    try:
        img = Image.open(path)
        exif = img.getexif()
        if not exif:
            return None
        gps = exif.get_ifd(EXIF_GPS)
        if not gps:
            return None
        lat_dms = gps.get(GPS_TAGS["GPSLatitude"])
        lat_ref = gps.get(GPS_TAGS["GPSLatitudeRef"])
        lon_dms = gps.get(GPS_TAGS["GPSLongitude"])
        lon_ref = gps.get(GPS_TAGS["GPSLongitudeRef"])
        if not all([lat_dms, lat_ref, lon_dms, lon_ref]):
            return None
        lat = dms_to_decimal(lat_dms, lat_ref)
        lon = dms_to_decimal(lon_dms, lon_ref)
        # date taken
        dt = exif.get(306)  # DateTime tag
        if not dt:
            ifd = exif.get_ifd(34665)  # ExifIFD
            dt = ifd.get(36867) if ifd else None  # DateTimeOriginal
        return lat, lon, dt, img.size
    except Exception:
        return None


def main():
    if not PHOTOS.exists():
        print(f"[error] {PHOTOS} not found", file=sys.stderr)
        sys.exit(1)

    matches = []
    scanned = 0
    skipped_no_gps = 0

    print(f"[scan] walking {PHOTOS}")
    for path in sorted(PHOTOS.iterdir()):
        ext = path.suffix.lower()
        if ext not in {".jpg", ".jpeg", ".heic", ".png"}:
            continue
        scanned += 1
        if scanned % 500 == 0:
            print(f"  ... scanned {scanned}, matches={len(matches)}", flush=True)

        result = extract_gps_and_date(path)
        if not result:
            skipped_no_gps += 1
            continue

        lat, lon, dt, size = result
        dist = haversine_m(lat, lon, SHOP_LAT, SHOP_LON)
        if dist <= RADIUS_METERS:
            matches.append({
                "path": str(path),
                "name": path.name,
                "size_kb": path.stat().st_size // 1024,
                "dimensions": size,
                "lat": lat,
                "lon": lon,
                "distance_m": round(dist, 1),
                "date": str(dt) if dt else None,
            })

    out = Path(__file__).resolve().parent.parent / "tmp" / "shop-photo-candidates.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(matches, indent=2, default=str))

    print()
    print(f"[done] scanned: {scanned}")
    print(f"[done] no GPS: {skipped_no_gps}")
    print(f"[done] matches within {RADIUS_METERS}m: {len(matches)}")
    print(f"[done] manifest: {out}")
    if matches:
        print()
        print("Sample matches (first 10):")
        for m in matches[:10]:
            print(f"  {m['name']}  {m['dimensions']}  {m['size_kb']}KB  {m['distance_m']}m  {m['date']}")


if __name__ == "__main__":
    main()
