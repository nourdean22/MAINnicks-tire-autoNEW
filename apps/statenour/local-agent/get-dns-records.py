import requests
import json

r = requests.get(
    'https://api.resend.com/domains',
    headers={'Authorization': 'Bearer re_DG9pEJ2C_QF9MnW5aMMCHRzzyUJ3kNUMt'}
)
domains = r.json()
print("=== DOMAINS ===")
print(json.dumps(domains, indent=2))

# Get specific domain details
if 'data' in domains:
    for d in domains['data']:
        domain_id = d['id']
        r2 = requests.get(
            f'https://api.resend.com/domains/{domain_id}',
            headers={'Authorization': 'Bearer re_DG9pEJ2C_QF9MnW5aMMCHRzzyUJ3kNUMt'}
        )
        print(f"\n=== DOMAIN: {d.get('name','')} ===")
        print(json.dumps(r2.json(), indent=2))
