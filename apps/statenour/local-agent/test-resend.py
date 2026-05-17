import requests
r = requests.post(
    'https://api.resend.com/emails',
    json={
        'from': 'NOUR OS <onboarding@resend.dev>',
        'to': 'nourdean22@gmail.com',
        'subject': 'NOUR OS - Notifications Live',
        'text': 'Resend email integration is connected. Telegram + Email notifications are operational.'
    },
    headers={'Authorization': 'Bearer re_DG9pEJ2C_QF9MnW5aMMCHRzzyUJ3kNUMt'}
)
print(r.status_code, r.text)
