# DG Fuel & Running Dashboard

A simple, maintainable DG monitoring dashboard built with **Python + GitHub Actions + GitHub Pages**.

The source workbook stays in Google Drive. The workflow downloads it every day around **10:00 AM IST**, processes the month-wise DG sheets, updates `site/data/data.json`, and publishes the interactive dashboard.

## Dashboard features

- All-month history and a month filter
- DG1–DG6 filter
- Running hours
- Fuel consumption
- Average fuel consumption (L/hr)
- Fuel added
- Current stock
- Fuel pending to reach the reserve
- Excess stock above the reserve
- Fuel-added vs consumption trend
- Monthly consumption trend
- Monthly running-hours trend
- DG stock status
- Stock reconciliation / adjustment alerts

## Repository layout

```text
.
├── site/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/data.json
├── scripts/
│   ├── download_drive.py
│   ├── process_dg.py
│   └── xlsx_reader.py
├── tests/test_process.py
├── requirements.txt
└── .github/workflows/dashboard.yml
```

## 1. Create the GitHub repository

Create a repository such as `dg-dashboard` and upload this project.

For the simplest public dashboard, make the repository **public**. GitHub Pages is also available for private repositories on plans that support private Pages.

## 2. Configure the Google Drive source

The workflow expects the file ID in the repository secret:

`GOOGLE_DRIVE_FILE_ID`

For a Drive URL like:

```text
https://drive.google.com/file/d/1ABC123/view
```

the file ID is:

```text
1ABC123
```

### Easiest mode: link-accessible source

If the XLSX can be shared as **Anyone with the link → Viewer**, leave `GOOGLE_SERVICE_ACCOUNT_JSON` unset. The workflow will use the public Drive download endpoint.

### Private source mode: recommended when the workbook should stay private

Create a Google Cloud service account, enable the Google Drive API, then share the XLSX with the service account's email address as Viewer.

Add the downloaded service-account JSON contents as a GitHub Actions secret named:

`GOOGLE_SERVICE_ACCOUNT_JSON`

The Python script automatically uses the service-account credentials when that secret exists.

## 3. Add GitHub secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**

Required:

- `GOOGLE_DRIVE_FILE_ID`

Optional, for private Drive access:

- `GOOGLE_SERVICE_ACCOUNT_JSON`

Do **not** put the service-account JSON in the repository.

## 4. Enable GitHub Pages

Repository → **Settings → Pages**

Under **Build and deployment → Source**, select **GitHub Actions**.

The included workflow deploys the `site/` folder.

## 5. Run the first update manually

Go to **Actions → Update & Publish DG Dashboard → Run workflow**.

The workflow will:

1. Download the current Drive workbook.
2. Read sheets such as `JUL 26`, `Aug 26`, `Sep 26`.
3. Normalize DG1–DG6 daily readings.
4. Calculate runtime, consumption, L/hr, fuel added, current stock, pending fuel and excess stock.
5. Flag stock reconciliation adjustments.
6. Run the Python test suite.
7. Refresh `site/data/data.json`.
8. Publish the dashboard to GitHub Pages.

## 6. Daily sync

The same workflow runs automatically around **10:00 AM Asia/Kolkata every day**. GitHub Actions supports timezone-aware schedules; execution can still be delayed by queueing or GitHub load.

## Fuel calculations

For each DG and period:

```text
Consumption = Opening Stock + Fuel Added - Closing Stock
Average L/hr = Consumption / Running Hours
```

A negative reconciliation is not treated as negative consumption. It is reported separately as a **stock adjustment**.

The reserve is currently 20% of tank capacity, with these capacities inferred from the current workbook:

| DG | Tank capacity |
|---|---:|
| DG1 | 1,000 L |
| DG2 | 1,000 L |
| DG3 | 500 L |
| DG4 | 1,000 L |
| DG5 | 1,000 L |
| DG6 | 800 L |

Change `DEFAULT_CAPACITIES` and `RESERVE_PCT` in `scripts/process_dg.py` if the actual tank sizes or reserve policy change.

## Local development

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

python -m pytest -q

python -m http.server 8000 --directory site
```

The test suite creates a small synthetic XLSX fixture, so no real DG workbook needs to be committed to the repository.

Open `http://localhost:8000`.

## Notes

- No real source workbook is stored in the repository. The test suite generates a synthetic XLSX fixture.
- `site/data/data.json` is intentionally committed so GitHub Pages can serve it as static data.
- The dashboard contains no server-side application; the browser only reads `data.json`.
