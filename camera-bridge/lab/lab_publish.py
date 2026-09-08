"""Publish a recorded Frigate JSONL fixture into the lab broker, paced (gap / SPEED, capped at 2 s)."""
import json
import sys
import time

import paho.mqtt.client as mqtt

path = sys.argv[1]
speed = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
msgs = []
for line in open(path, encoding="ascii"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    msgs.append(json.loads(line))

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="lab-publisher")
c.username_pw_set("visitd", "labpass")
c.connect("mqtt", 1883, 30)
c.loop_start()


def frame_time(m):
    p = m.get("payload")
    a = p.get("after") if isinstance(p, dict) else None
    return (a or {}).get("frame_time") or (p or {}).get("frame_time") if isinstance(p, dict) else None


prev = None
for i, m in enumerate(msgs):
    t = frame_time(m)
    if prev is not None and t is not None:
        gap = max(0.0, float(t) - float(prev))
        time.sleep(min(gap / speed, 2.0))
    if t is not None:
        prev = t
    payload = m["payload"]
    payload = payload if isinstance(payload, str) else json.dumps(payload)
    r = c.publish(m["topic"], payload, qos=1)
    r.wait_for_publish(5)
    print(f"published {i + 1}/{len(msgs)} {m['topic']} rc={r.rc}", flush=True)
c.loop_stop()
c.disconnect()
print("done")
