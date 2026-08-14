"""Small dependency-light XLSX reader for this DG workbook shape.

It intentionally avoids openpyxl/pandas so the scheduled job stays lightweight.
It reads workbook sheet names and cell values using the XLSX zip/XML format.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile
import re
import xml.etree.ElementTree as ET

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


@dataclass
class SheetData:
    name: str
    rows: list[list[object]]


def _col_to_num(cell_ref: str) -> int:
    letters = re.match(r"([A-Z]+)", cell_ref.upper())
    if not letters:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    value = 0
    for ch in letters.group(1):
        value = value * 26 + ord(ch) - 64
    return value - 1


def _parse_number(value: str) -> object:
    try:
        if re.fullmatch(r"[-+]?\d+", value.strip()):
            return int(value)
        return float(value)
    except ValueError:
        return value


def read_xlsx(path: str | Path) -> list[SheetData]:
    path = Path(path)
    with ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("main:si", NS):
                # Shared strings may contain multiple <t> nodes.
                text = "".join(t.text or "" for t in si.iter(f"{{{NS['main']}}}t"))
                shared_strings.append(text)

        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map: dict[str, str] = {}
        for rel in rels:
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target", "")
            if target.startswith("/"):
                target = target.lstrip("/")
            elif not target.startswith("xl/"):
                target = "xl/" + target
            rel_map[rid] = target

        sheets: list[SheetData] = []
        for sheet in workbook.find("main:sheets", NS) or []:
            name = sheet.attrib["name"]
            rid = sheet.attrib[f"{{{NS['rel']}}}id"]
            target = rel_map[rid]
            root = ET.fromstring(zf.read(target))
            raw_rows: list[dict[int, object]] = []
            max_col = -1
            for row in root.findall(".//main:sheetData/main:row", NS):
                cells: dict[int, object] = {}
                for c in row.findall("main:c", NS):
                    ref = c.attrib.get("r", "")
                    if not ref:
                        continue
                    col = _col_to_num(ref)
                    cell_type = c.attrib.get("t")
                    v = c.find("main:v", NS)
                    inline = c.find("main:is", NS)
                    if cell_type == "inlineStr" and inline is not None:
                        value = "".join(t.text or "" for t in inline.iter(f"{{{NS['main']}}}t"))
                    elif v is None:
                        value = None
                    else:
                        raw = v.text or ""
                        if cell_type == "s":
                            idx = int(raw)
                            value = shared_strings[idx] if idx < len(shared_strings) else raw
                        elif cell_type == "b":
                            value = raw == "1"
                        else:
                            value = _parse_number(raw)
                    cells[col] = value
                    max_col = max(max_col, col)
                raw_rows.append(cells)

            rows: list[list[object]] = []
            for cells in raw_rows:
                row = [None] * (max_col + 1 if max_col >= 0 else 0)
                for col, value in cells.items():
                    row[col] = value
                rows.append(row)
            sheets.append(SheetData(name=name, rows=rows))

        return sheets
