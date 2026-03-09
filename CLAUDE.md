# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A scheduling web app for "Journal Watch" — a recurring medical presentation series at the Herzzentrum / UKR (Universitätsklinikum Regensburg). It allows an admin to manage presenter assignments, swap presenters, track missed presentations, and print the schedule.

## Architecture

This is a **vanilla HTML/CSS/JS frontend** with no build step, no npm, no bundler. All runtime data is stored remotely in **JSONBin.io** bins (not in this repo).

### Data layer (`assets/js/app.js`)
Three JSONBin bins are read/written via the JSONBin v3 REST API:
- `SCHEDULE_BIN_ID` — array of `{ date, presenter, topic, forgotten, isNachholtermin }`
- `EMPLOYEES_BIN_ID` — array of `{ id, name, email, active, isOberarzt }`
- `DISTRIBUTION_BIN_ID` — monthly rotation import data with fields `mi` (Monat), `bi` (Bereich), `ei` (Mitarbeiter ID), `en` (Mitarbeiter Name)

All API calls require an `X-Master-Key` header. The key is stored in `localStorage` under `journal_api_key` — this is how "admin mode" is gated.

### Role logic
- **Monday slots** → Assistenzärzte (AA, `isOberarzt: false`)
- **Wednesday slots** → Oberärzte (OA, `isOberarzt: true`)

### `syncEmployeeIDs()`
Called after both employees and distribution data load. It cross-references the distribution list with the employees list by name (exact match, then last-name fallback) to assign numeric IDs and auto-discover new employees.

### Auto-distribution (`autoDistribute()`)
Reads the distribution bin to calculate how often each employee should present per quarter (proportional to their month count), then assigns them to unoccupied slots respecting role constraints.

### Python scripts (`scripts/`)
Utility scripts run locally or via GitHub Actions:
- `generate_schedule.py` — generates `data/schedule.json` (Mon/Wed slots for ~1 year). Run: `python scripts/generate_schedule.py`
- `setup_jsonbin.py` — uploads `data/schedule.json` and `data/employees.json` to JSONBin and prints the resulting bin IDs. Hardcodes the API key — update before running.
- `verify_jsonbin.py` — reads bins and prints their contents for inspection.
- `send_reminders.py` — sends email reminders for next week's presentations. Reads config from env vars: `JSONBIN_API_KEY`, `SCHEDULE_BIN_ID`, `EMPLOYEES_BIN_ID`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`.
- `check_distribution_data.py` — inspects the distribution bin.

### GitHub Actions
A `reminder.yml` workflow (must be created manually per `SETUP_GUIDE.md`) runs `send_reminders.py` daily at 08:00 UTC using secrets stored in the repo.

### Local data files
`data/schedule.json` and `data/employees.json` contain placeholder/seed data. These are only used to initially populate the JSONBin bins — the live source of truth is JSONBin.

## Running the app

Open `index.html` directly in a browser (no server needed). Login with the JSONBin master API key to enter admin mode.

## Key bin IDs (hardcoded in `app.js:1-3`)
```
SCHEDULE_BIN_ID     = "699332e2ae596e708f2f7434"
EMPLOYEES_BIN_ID    = "699333dcd0ea881f40bf132f"
DISTRIBUTION_BIN_ID = "699c40edae596e708f42284d"
```

## Language
UI and data are in German. Code comments and variable names are a mix of German and English.
