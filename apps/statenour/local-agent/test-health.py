import requests
try:
    r = requests.get('http://localhost:3600/health', timeout=5)
    print(r.status_code, r.text[:300])
except Exception as e:
    print(f"Error: {e}")
