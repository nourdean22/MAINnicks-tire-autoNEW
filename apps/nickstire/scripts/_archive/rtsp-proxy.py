"""
RTSP to MJPEG Proxy — Run on shop PC (192.168.0.157)

Captures V380 camera RTSP streams and serves as MJPEG
that browsers can display directly.

Usage: python rtsp-proxy.py
Then access: http://192.168.0.157:8888/camera/outside
"""

import cv2
from flask import Flask, Response
import threading
import time

app = Flask(__name__)

# Camera configs — edit IPs as needed
CAMERAS = {
    "outside": "rtsp://admin:admin@192.168.0.154:554/live/ch00_1",
    "inside": "rtsp://admin:admin@192.168.0.154:554/live/ch00_1",
}

# Frame cache
frames = {}
locks = {}

def capture_camera(name, url):
    """Continuously capture frames from RTSP stream."""
    locks[name] = threading.Lock()
    while True:
        try:
            cap = cv2.VideoCapture(url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                with locks[name]:
                    frames[name] = frame
            cap.release()
        except Exception as e:
            print(f"[{name}] Error: {e}")
        time.sleep(2)  # Retry after 2s

def generate_mjpeg(name):
    """Generate MJPEG stream from cached frames."""
    while True:
        if name in frames and frames[name] is not None:
            with locks[name]:
                _, jpeg = cv2.imencode('.jpg', frames[name], [cv2.IMWRITE_JPEG_QUALITY, 70])
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
        time.sleep(0.1)  # ~10 FPS

@app.route('/camera/<name>')
def video_feed(name):
    if name not in CAMERAS:
        return f"Camera '{name}' not found. Available: {list(CAMERAS.keys())}", 404
    return Response(generate_mjpeg(name),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/snapshot/<name>')
def snapshot(name):
    if name not in frames or frames[name] is None:
        return "No frame available", 503
    with locks[name]:
        _, jpeg = cv2.imencode('.jpg', frames[name], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return Response(jpeg.tobytes(), mimetype='image/jpeg')

@app.route('/')
def index():
    cams = ", ".join(f'<a href="/camera/{n}">{n}</a>' for n in CAMERAS)
    return f"<h1>RTSP Proxy</h1><p>Cameras: {cams}</p>"

if __name__ == '__main__':
    # Start capture threads
    for name, url in CAMERAS.items():
        t = threading.Thread(target=capture_camera, args=(name, url), daemon=True)
        t.start()
        print(f"[{name}] Capturing from {url}")

    print("MJPEG proxy running on http://0.0.0.0:8888")
    app.run(host='0.0.0.0', port=8888, threaded=True)
