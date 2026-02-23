import json
import urllib.request
import urllib.error

API_KEY = "$2a$10$5f5WR8jrQAQp2TgNWGvWb.2tp/RA1ZzQzMv3SY5uwYnm5oqz66yxa"
BIN_ID = "699c40edae596e708f42284d"
BASE_URL = f"https://api.jsonbin.io/v3/b/{BIN_ID}/latest"

def check_bin():
    headers = {
        "X-Master-Key": API_KEY,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        req = urllib.request.Request(BASE_URL, headers=headers)
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            record = result.get("record", [])
            print(f"Success! Bin contains {len(record)} records.")
            if record:
                print("First record structure:")
                print(json.dumps(record[0], indent=2))
                
                # Check for specific keys
                keys = list(record[0].keys())
                print(f"Available keys: {keys}")
                
                # Sample some names if available
                names = [r.get("en", "N/A") for r in record[:5]]
                print(f"Sample names (en): {names}")
                
            return record
    except urllib.error.HTTPError as e:
        print(f"Error checking bin: {e.code} - {e.read().decode()}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    check_bin()
