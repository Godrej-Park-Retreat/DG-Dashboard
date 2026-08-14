import json
import subprocess
import sys
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "data" / "test-data.json"


def make_fixture(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "JUL 26"

    # Row 1: headers, row 2: subheaders, row 3+: daily data.
    ws.append(["Day"] + [f"DG{i}" for i in range(1, 7) for _ in range(4)])
    ws.append(["Day"] + ["RH", "%", "Stock", "Fuel"] * 6)

    # Day 1: opening stock and running-hours meter.
    row = [1]
    for i in range(6):
        row += [100 + i, 50, 100, 0]
    ws.append(row)

    # Day 2: each DG runs 5h; stock falls by 10L; DG1 gets 20L added.
    row = [2]
    for i in range(6):
        row += [105 + i, 40, 90, 20 if i == 0 else 0]
    ws.append(row)

    # Add a second month to ensure month discovery works.
    ws2 = wb.create_sheet("AUG 26")
    ws2.append(["Day"] + [f"DG{i}" for i in range(1, 7) for _ in range(4)])
    ws2.append(["Day"] + ["RH", "%", "Stock", "Fuel"] * 6)
    row = [1]
    for i in range(6):
        row += [110 + i, 45, 80, 0]
    ws2.append(row)
    row = [2]
    for i in range(6):
        row += [112 + i, 40, 70, 0]
    ws2.append(row)

    wb.save(path)


def test_sample_processing(tmp_path):
    fixture = tmp_path / "DG Readings.xlsx"
    make_fixture(fixture)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "process_dg.py"),
            "--xlsx",
            str(fixture),
            "--out",
            str(OUT),
        ],
        check=True,
    )

    data = json.loads(OUT.read_text())
    assert data["dgs"] == ["DG1", "DG2", "DG3", "DG4", "DG5", "DG6"]
    assert "2026-07" in data["months"]
    assert "2026-08" in data["months"]
    assert data["current"]

    # 5 hours runtime for each DG in July. DG1 consumption:
    # opening 100 + fuel 20 - closing 90 = 30 L.
    july_dg1 = next(r for r in data["monthly"] if r["month"] == "2026-07" and r["dg"] == "DG1")
    assert july_dg1["running_hours"] == 5.0
    assert july_dg1["consumption"] == 30.0
    assert july_dg1["avg_lph"] == 6.0

    OUT.unlink(missing_ok=True)
