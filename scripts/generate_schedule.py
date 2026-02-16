import json
from datetime import date, timedelta

def generate_schedule(start_date, num_months=12):
    schedule = []
    current_date = start_date
    end_date = start_date.replace(year=start_date.year + 1) # Approx 1 year

    while current_date < end_date:
        # Monday is 0, Wednesday is 2
        if current_date.weekday() in [0, 2]:
            schedule.append({
                "date": current_date.isoformat(),
                "presenter": "",  # To be filled
                "topic": ""        # Optional
            })
        current_date += timedelta(days=1)
    
    return schedule

if __name__ == "__main__":
    # Start from next month or specific date
    start = date.today() 
    
    schedule_data = generate_schedule(start)
    
    output_path = "data/schedule.json"
    import os
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schedule_data, f, indent=4)
        
    print(f"Generated {len(schedule_data)} slots in {output_path}")
