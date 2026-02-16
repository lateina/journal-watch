import urllib.request
import urllib.error
import json

API_KEY = "$2a$10$5f5WR8jrQAQp2TgNWGvWb.2tp/RA1ZzQzMv3SY5uwYnm5oqz66yxa"
BIN_ID = "699332e2ae596e708f2f7434"
BASE_URL = "https://api.jsonbin.io/v3/b"

def read_bin(bin_id):
    url = f"{BASE_URL}/{bin_id}"
    headers = {
        "X-Access-Key": API_KEY
    }
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"Successfully read bin {bin_id}")
            print(json.dumps(result, indent=2))
            return True
    except urllib.error.HTTPError as e:
        print(f"Error reading bin {bin_id}: {e.code} - {e.read().decode()}")
        return False

def update_bin(bin_id, data):
    url = f"{BASE_URL}/{bin_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
    }
    
    try:
        req = urllib.request.Request(
            url, 
            data=json.dumps(data).encode('utf-8'), 
            headers=headers, 
            method='PUT'
        )
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"Successfully updated bin {bin_id}")
            return True
    except urllib.error.HTTPError as e:
        print(f"Error updating bin {bin_id}: {e.code} - {e.read().decode()}")
        return False

if __name__ == "__main__":
    if read_bin(BIN_ID):
        # If read success, try to upload schedule
        with open("data/schedule.json", "r") as f:
            schedule_data = json.load(f)
        
        print("Attempting to upload schedule data...")
        update_bin(BIN_ID, schedule_data)
