from datetime import datetime, timedelta

today = datetime(2026, 4, 22).date() # Today is Wednesday
days_until_next_monday = 7 - today.weekday()
start_date = today + timedelta(days=days_until_next_monday)
end_date = start_date + timedelta(days=4)

print(f"Today: {today} (Weekday {today.weekday()})")
print(f"Start date (Next Monday): {start_date}")
print(f"End date (Next Friday): {end_date}")
