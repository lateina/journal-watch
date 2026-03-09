import json
import os
import urllib.request
import urllib.error

API_KEY = os.environ.get("JSONBIN_API_KEY", "")
BASE_URL = "https://api.jsonbin.io/v3/b"

def create_bin(name, data, private=True):
    headers = {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY,
        "X-Bin-Name": name,
        "X-Bin-Private": "true" if private else "false"
    }
    
    try:
        req = urllib.request.Request(
            BASE_URL, 
            data=json.dumps(data).encode('utf-8'), 
            headers=headers, 
            method='POST'
        )
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"Success! Created bin '{name}'")
            return result.get("metadata", {}).get("id")
    except urllib.error.HTTPError as e:
        print(f"Error creating bin '{name}': {e.code} - {e.read().decode()}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)

if __name__ == "__main__":
    if not API_KEY:
        print("Fehler: Umgebungsvariable JSONBIN_API_KEY nicht gesetzt.")
        exit(1)
    try:
        schedule = load_json("data/schedule.json")
        employees = load_json("data/employees.json")
        
        # Schedule bin - Public for website readability
        schedule_bin_id = create_bin("JournalWatch_Schedule", schedule, private=False)
        if schedule_bin_id:
            print(f"SCHEDULE_BIN_ID={schedule_bin_id}")
        
        # Employees bin - Private for bot only
        employees_bin_id = create_bin("JournalWatch_Employees", employees, private=True)
        if employees_bin_id:
            print(f"EMPLOYEES_BIN_ID={employees_bin_id}")
            
    except FileNotFoundError:
        print("Error: content files not found in data/")
