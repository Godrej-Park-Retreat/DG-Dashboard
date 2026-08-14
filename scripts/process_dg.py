from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

from xlsx_reader import read_xlsx

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
DG_COUNT = 6
DEFAULT_CAPACITIES = {"DG1": 1000, "DG2": 1000, "DG3": 500, "DG4": 1000, "DG5": 1000, "DG6": 800}
RESERVE_PCT = 0.20
MONTH_RE = re.compile(r"^[A-Za-z]{3}\s+\d{2}$")


@dataclass
class Reading:
    date: str
    month: str
    dg: str
    running_hours: float | None
    balance_pct: float | None
    stock: float | None
    fuel_added: float


@dataclass
class Monthly:
    month: str
    dg: str
    running_hours: float
    consumption: float
    fuel_added: float
    avg_lph: float
    opening_stock: float
    closing_stock: float
    tank_capacity: float
    reserve: float
    fuel_pending: float
    excess_stock: float
    adjustment: float
    last_reading: str | None


@dataclass
class Daily:
    date: str
    month: str
    dg: str
    runtime_hours: float
    consumption: float
    adjustment: float
    fuel_added: float
    stock: float | None
    running_hours_meter: float | None


def num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def parse_source(xlsx_path: Path) -> list[Reading]:
    readings: list[Reading] = []
    for sheet in read_xlsx(xlsx_path):
        name = sheet.name.strip()
        if not MONTH_RE.match(name):
            continue
        abbr, yy = name.upper().split()
        month_no = MONTHS.get(abbr)
        if not month_no:
            continue
        year = 2000 + int(yy)
        if len(sheet.rows) < 3:
            continue
        for row in sheet.rows[2:]:
            day = num(row[0] if row else None)
            if day is None or not (1 <= day <= 31):
                continue
            try:
                dt = date(year, month_no, int(day))
            except ValueError:
                continue
            for idx in range(DG_COUNT):
                base = 1 + idx * 4
                vals = row[base:base + 4]
                while len(vals) < 4:
                    vals.append(None)
                rh, pct, stock, fuel = (num(v) for v in vals)
                # Ignore completely empty/template rows.
                if rh is None and pct is None and stock is None and (fuel is None or fuel == 0):
                    continue
                # Rows with stock=0 and no meter/percentage are template rows in this workbook.
                if rh is None and pct is None and (stock is None or stock == 0) and (fuel is None or fuel == 0):
                    continue
                readings.append(
                    Reading(
                        date=dt.isoformat(),
                        month=dt.strftime("%Y-%m"),
                        dg=f"DG{idx + 1}",
                        running_hours=rh,
                        balance_pct=pct,
                        stock=stock,
                        fuel_added=fuel or 0.0,
                    )
                )
    readings.sort(key=lambda r: (r.dg, r.date))
    return readings


def infer_capacities(readings: list[Reading]) -> dict[str, float]:
    caps = dict(DEFAULT_CAPACITIES)
    for r in readings:
        if r.balance_pct and r.stock is not None and r.balance_pct > 0:
            inferred = round(r.stock / (r.balance_pct / 100.0))
            if inferred in (500, 800, 1000):
                caps[r.dg] = inferred
    return caps


def build_daily(readings: list[Reading]) -> list[Daily]:
    previous: dict[str, Reading] = {}
    out: list[Daily] = []
    for r in readings:
        p = previous.get(r.dg)
        runtime = 0.0
        if p and p.running_hours is not None and r.running_hours is not None:
            runtime = max(0.0, r.running_hours - p.running_hours)
        consumption = 0.0
        adjustment = 0.0
        if p and p.stock is not None and r.stock is not None:
            raw = p.stock + r.fuel_added - r.stock
            if raw >= 0:
                consumption = raw
            else:
                adjustment = -raw
        out.append(
            Daily(
                date=r.date,
                month=r.month,
                dg=r.dg,
                runtime_hours=runtime,
                consumption=consumption,
                adjustment=adjustment,
                fuel_added=r.fuel_added,
                stock=r.stock,
                running_hours_meter=r.running_hours,
            )
        )
        previous[r.dg] = r
    return out


def build_monthly(readings: list[Reading], capacities: dict[str, float]) -> list[Monthly]:
    groups: dict[tuple[str, str], list[Reading]] = defaultdict(list)
    for r in readings:
        groups[(r.month, r.dg)].append(r)
    out: list[Monthly] = []
    for (month, dg), rows in sorted(groups.items()):
        rows = sorted(rows, key=lambda r: r.date)
        stock_rows = [r for r in rows if r.stock is not None]
        rh_rows = [r for r in rows if r.running_hours is not None]
        if not stock_rows:
            continue
        first_stock, last_stock = stock_rows[0], stock_rows[-1]
        opening = float(first_stock.stock or 0)
        closing = float(last_stock.stock or 0)
        fuel = sum(r.fuel_added for r in rows)
        raw = opening + fuel - closing
        consumption = max(0.0, raw)
        adjustment = max(0.0, -raw)
        runtime = 0.0
        if len(rh_rows) >= 2:
            runtime = max(0.0, rh_rows[-1].running_hours - rh_rows[0].running_hours)
        cap = capacities.get(dg, 1000)
        reserve = cap * RESERVE_PCT
        pending = max(0.0, reserve - closing)
        excess = max(0.0, closing - reserve)
        out.append(
            Monthly(
                month=month,
                dg=dg,
                running_hours=runtime,
                consumption=consumption,
                fuel_added=fuel,
                avg_lph=(consumption / runtime if runtime > 0 else 0.0),
                opening_stock=opening,
                closing_stock=closing,
                tank_capacity=cap,
                reserve=reserve,
                fuel_pending=pending,
                excess_stock=excess,
                adjustment=adjustment,
                last_reading=last_stock.date,
            )
        )
    return out


def current_status(readings: list[Reading], capacities: dict[str, float]) -> list[dict[str, Any]]:
    latest: dict[str, Reading] = {}
    for r in readings:
        latest[r.dg] = r
    out = []
    for dg in sorted(latest):
        r = latest[dg]
        cap = capacities.get(dg, 1000)
        reserve = cap * RESERVE_PCT
        stock = float(r.stock or 0)
        out.append({
            "dg": dg,
            "date": r.date,
            "running_hours_meter": r.running_hours,
            "stock": stock,
            "balance_pct": r.balance_pct,
            "tank_capacity": cap,
            "reserve": reserve,
            "fuel_pending": max(0.0, reserve - stock),
            "excess_stock": max(0.0, stock - reserve),
        })
    return out


def make_payload(readings: list[Reading], monthly: list[Monthly], daily: list[Daily], capacities: dict[str, float], source_name: str) -> dict[str, Any]:
    all_dates = [r.date for r in readings]
    months = sorted({r.month for r in readings})
    dgs = sorted({r.dg for r in readings})
    return {
        "schema_version": 1,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "source_file": source_name,
        "reserve_pct": RESERVE_PCT,
        "date_from": min(all_dates) if all_dates else None,
        "date_to": max(all_dates) if all_dates else None,
        "months": months,
        "dgs": dgs,
        "capacities": capacities,
        "monthly": [asdict(x) for x in monthly],
        "daily": [asdict(x) for x in daily],
        "current": current_status(readings, capacities),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    xlsx = Path(args.xlsx)
    readings = parse_source(xlsx)
    if not readings:
        raise SystemExit("No DG readings were found in the workbook.")
    capacities = infer_capacities(readings)
    daily = build_daily(readings)
    monthly = build_monthly(readings, capacities)
    payload = make_payload(readings, monthly, daily, capacities, xlsx.name)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Processed {len(readings)} readings -> {out}")
    print(f"Dates: {payload['date_from']} to {payload['date_to']}")
    print(f"Months: {', '.join(months := payload['months'])}")
    print(f"DGs: {', '.join(payload['dgs'])}")


if __name__ == "__main__":
    main()
