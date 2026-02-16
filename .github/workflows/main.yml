# Setup Guide: Journal Watch

## WICHTIG: Automation aktivieren
Da ich aus Sicherheitsgründen die "Workflow"-Datei nicht hochladen durfte, müssen Sie diese einmalig manuell auf GitHub erstellen.

1.  Gehen Sie auf Ihr Repo: `https://github.com/lateina/journal-watch`
2.  Klicken Sie auf den Reiter **Actions**.
3.  Klicken Sie auf **set up a workflow yourself** (oder "New workflow").
4.  Nennen Sie die Datei `reminder.yml`.
5.  Kopieren Sie folgenden Inhalt hinein und klicken Sie auf **Commit changes**:

```yaml
name: Send Reminders

on:
  schedule:
    - cron: '0 8 * * *' # Täglich um 8:00 UTC (9:00/10:00 DE)
  workflow_dispatch:

jobs:
  check-and-send:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install requests

      - name: Run Reminder Script
        env:
          JSONBIN_API_KEY: ${{ secrets.JSONBIN_API_KEY }}
          SCHEDULE_BIN_ID: ${{ secrets.SCHEDULE_BIN_ID }}
          EMPLOYEES_BIN_ID: ${{ secrets.EMPLOYEES_BIN_ID }}
          EMAIL_HOST_USER: ${{ secrets.EMAIL_HOST_USER }}
          EMAIL_HOST_PASSWORD: ${{ secrets.EMAIL_HOST_PASSWORD }}
        run: python scripts/send_reminders.py
```

## 1. GitHub Secrets (Für Email-Versand)
... (Rest der Anleitung bleibt gleich)
