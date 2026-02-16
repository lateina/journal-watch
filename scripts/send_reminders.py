import os
import json
import requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta

# Configuration from Environment Variables
API_KEY = os.environ.get("JSONBIN_API_KEY")
SCHEDULE_BIN_ID = os.environ.get("SCHEDULE_BIN_ID")
EMPLOYEES_BIN_ID = os.environ.get("EMPLOYEES_BIN_ID")
EMAIL_USER = os.environ.get("EMAIL_HOST_USER")
EMAIL_PASS = os.environ.get("EMAIL_HOST_PASSWORD")

def fetch_json(bin_id):
    url = f"https://api.jsonbin.io/v3/b/{bin_id}/latest"
    headers = {"X-Access-Key": API_KEY} # Or X-Master-Key
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()['record']

def send_email(to_email, presenter_name, date_str):
    subject = f"Erinnerung: Journal Watch Präsentation am {date_str}"
    body = f"""
    Hallo {presenter_name},
    
    Dies ist eine automatische Erinnerung.
    Sie sind für den Journal Watch am {date_str} eingeteilt.
    
    Bitte bereiten Sie Ihren Beitrag vor.
    
    Viele Grüße,
    Journal Watch Bot
    """
    
    msg = MIMEMultipart()
    msg['From'] = EMAIL_USER
    msg['To'] = to_email
    msg['Bcc'] = EMAIL_USER
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASS)
        text = msg.as_string()
        server.sendmail(EMAIL_USER, [to_email, EMAIL_USER], text)
        server.quit()
        print(f"Email sent to {to_email} (BCC: {EMAIL_USER})")
    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")

def main():
    if not all([API_KEY, SCHEDULE_BIN_ID, EMPLOYEES_BIN_ID, EMAIL_USER, EMAIL_PASS]):
        print("Missing environment variables.")
        return

    print("Fetching data...")
    schedule = fetch_json(SCHEDULE_BIN_ID)
    employees = fetch_json(EMPLOYEES_BIN_ID)
    
    # Map employees by name for easy lookup
    # Assuming "name" is unique and matches "presenter" in schedule
    employee_map = {e['name']: e['email'] for e in employees if e.get('active')}
    
    today = datetime.now().date()
    # Assuming script runs on Wednesday:
    # Next Monday = today + 5
    # Next Wednesday = today + 7
    start_date = today + timedelta(days=5)
    end_date = today + timedelta(days=7)
    
    print(f"Checking for presentations between {start_date} and {end_date}...")
    
    count = 0
    for slot in schedule:
        slot_date = datetime.strptime(slot['date'], "%Y-%m-%d").date()
        
        if start_date <= slot_date <= end_date:
            presenter = slot.get('presenter')
            if presenter and presenter in employee_map:
                email = employee_map[presenter]
                print(f"Found slot for {presenter} on {slot['date']} ({email})")
                send_email(email, presenter, slot['date'])
                count += 1
            elif presenter:
                print(f"Warning: No email found for presenter '{presenter}' on {slot['date']}")
    
    if count == 0:
        print("No reminders to send today.")

if __name__ == "__main__":
    main()
