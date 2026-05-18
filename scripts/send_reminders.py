import os
import json
import requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta

# Configuration from Environment Variables
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY")
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID")
EMAIL_USER = os.environ.get("EMAIL_HOST_USER")
EMAIL_PASS = os.environ.get("EMAIL_HOST_PASSWORD")

def get_auth_token(api_key):
    try:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}"
        headers = {
            'Referer': 'https://lateina.github.io/',
            'Origin': 'https://lateina.github.io'
        }
        res = requests.post(url, headers=headers, json={"returnSecureToken": True})
        res.raise_for_status()
        return res.json().get('idToken')
    except Exception as e:
        print(f"Auth failed: {e}")
        return None

def from_firestore(fields):
    if not fields: return {}
    res = {}
    for key, val in fields.items():
        if 'stringValue' in val: res[key] = val['stringValue']
        elif 'booleanValue' in val: res[key] = val['booleanValue']
        elif 'integerValue' in val: res[key] = int(val['integerValue'])
        elif 'arrayValue' in val:
            values = val['arrayValue'].get('values', [])
            res[key] = [v.get('stringValue') or (from_firestore(v.get('mapValue', {}).get('fields', {})) if 'mapValue' in v else v) for v in values]
        elif 'mapValue' in val:
            res[key] = from_firestore(val['mapValue'].get('fields', {}))
    return res

def fetch_firestore_document(path):
    token = get_auth_token(FIREBASE_API_KEY)
    url = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/{path}?key={FIREBASE_API_KEY}"
    headers = {
        'Referer': 'https://lateina.github.io/',
        'Origin': 'https://lateina.github.io'
    }
    if token:
        headers['Authorization'] = f"Bearer {token}"
    
    res = requests.get(url, headers=headers)
    res.raise_for_status()
    data = res.json()
    return from_firestore(data.get('fields', {}))

def send_email(to_email, presenter_name, date_str):
    subject = f"Erinnerung: Journal Watch Präsentation am {date_str}"
    body = f"""
    Hallo {presenter_name},
    
    Dies ist eine Erinnerung.
    Sie sind für den Journal Watch am {date_str} eingeteilt.
    
    Bitte bereiten Sie Ihren Beitrag vor.
    Weitere Details finden Sie unter: https://lateina.github.io/journal-watch/
    
    Mit freundlichen Grüßen,
    A. Rohrmaier

    Astrid Rohrmaier
    Oberarzt-Sekretariat Kardiologie
    Universitätsklinikum Regensburg
    Franz-Josef-Strauß-Allee 11
    93053 Regensburg
    astrid.rohrmaier@ukr.de
    Tel.: 0941-9447207
    """
    
    msg = MIMEMultipart()
    msg['From'] = EMAIL_USER
    msg['To'] = to_email
    msg['Bcc'] = EMAIL_USER
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.set_debuglevel(0)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASS)
        text = msg.as_string()
        server.sendmail(EMAIL_USER, [to_email, EMAIL_USER], text)
        server.quit()
        print(f"Email sent to {to_email} (BCC: {EMAIL_USER})")
    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")

def main():
    if not all([FIREBASE_API_KEY, FIREBASE_PROJECT_ID, EMAIL_USER, EMAIL_PASS]):
        print("Missing environment variables (FIREBASE_API_KEY, FIREBASE_PROJECT_ID, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD).")
        return

    print("Fetching data from Firestore...")
    try:
        schedule_data = fetch_firestore_document('up_config/jw_schedule')
        config_data = fetch_firestore_document('up_config/main')
        
        schedule = schedule_data.get('data', [])
        employees = config_data.get('employees', [])
    except Exception as e:
        print(f"Failed to fetch data: {e}")
        return
    
    # Map employees by name for easy lookup
    employee_map = {e['name']: e['email'] for e in employees if e.get('active') and e.get('email')}
    
    today = datetime.now().date()
    days_until_next_monday = 7 - today.weekday()
    
    # Next week
    start_date_1 = today + timedelta(days=days_until_next_monday)
    end_date_1 = start_date_1 + timedelta(days=4)
    
    # Week after next (two weeks)
    start_date_2 = start_date_1 + timedelta(days=7)
    end_date_2 = start_date_2 + timedelta(days=4)
    
    print(f"Checking for presentations next week ({start_date_1} to {end_date_1}) and in two weeks ({start_date_2} to {end_date_2})...")
    
    count = 0
    for slot in schedule:
        if not slot.get('date'): continue
        slot_date = datetime.strptime(slot['date'], "%Y-%m-%d").date()
        
        if (start_date_1 <= slot_date <= end_date_1) or (start_date_2 <= slot_date <= end_date_2):
            presenter = slot.get('presenter')
            if presenter and presenter in employee_map:
                email = employee_map[presenter]
                formatted_date = slot_date.strftime("%d.%m.%Y")
                print(f"Found slot for {presenter} on {slot['date']} ({email})")
                send_email(email, presenter, formatted_date)
                count += 1
            elif presenter:
                print(f"Warning: No email found for presenter '{presenter}' on {slot['date']}")
    
    if count == 0:
        print("No reminders to send today.")

if __name__ == "__main__":
    main()
