"""Lookup of CSM Name on the workbook CSM tab.

The header is not on row 1. Row 1 of the export is a totals row.
Match is exact: Alerts enterprise_id -> Enterprise ID -> CSM Name.
When the same enterprise has a Studio row and a Vini row, the Vini CSM Name wins.
The CSM Name cell is kept as stored, including @spyne.ai.
"""

from __future__ import annotations

import csv
import io
import os
import urllib.request

from vini_alert.sheet import SPREADSHEET_ID

CSM_GID = "376341429"
PUBLIC_CSM_CSV = (
    "https://docs.google.com/spreadsheets/d/"
    f"{SPREADSHEET_ID}/export?format=csv&gid={CSM_GID}"
)

_EMPTY = {"", "unassigned", "#n/a", "n/a", "#ref!", "—", "-"}


def _clean(value: str) -> str:
    text = " ".join(str(value or "").split())
    if text.lower() in _EMPTY:
        return ""
    return text


def _header_map(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    for index, row in enumerate(rows[:15]):
        mapping: dict[str, int] = {}
        for col, cell in enumerate(row):
            name = str(cell or "").strip().lower()
            if name in {"enterprise id", "enterprise_id"} and "enterprise_id" not in mapping:
                mapping["enterprise_id"] = col
            elif name in {"customer", "account", "rooftop_name", "rooftop name"} and "customer" not in mapping:
                mapping["customer"] = col
            elif name == "csm name" or (name == "csm" and "csm" not in mapping):
                mapping["csm"] = col
            elif name == "product" and "product" not in mapping:
                mapping["product"] = col
        if "enterprise_id" in mapping and "csm" in mapping:
            return index, mapping
    return None


def _remember(bucket: dict[str, tuple[int, str]], key: str, csm: str, rank: int) -> None:
    if not key:
        return
    prev = bucket.get(key)
    if prev is None:
        bucket[key] = (rank, csm)
        return
    prev_rank, _prev_csm = prev
    if rank > prev_rank or (rank == prev_rank and csm):
        bucket[key] = (rank, csm)


def parse_csm_table(text: str) -> dict[str, dict[str, str]]:
    rows = list(csv.reader(io.StringIO(text)))
    found = _header_map(rows)
    ranked_id: dict[str, tuple[int, str]] = {}
    ranked_name: dict[str, tuple[int, str]] = {}
    if not found:
        return {"by_id": {}, "by_name": {}}
    header_index, mapping = found
    id_col = mapping["enterprise_id"]
    name_col = mapping.get("customer")
    csm_col = mapping["csm"]
    product_col = mapping.get("product")
    for row in rows[header_index + 1 :]:
        if id_col >= len(row) or csm_col >= len(row):
            continue
        enterprise_id = str(row[id_col] or "").strip()
        if not enterprise_id or enterprise_id.lower() == "enterprise id":
            continue
        csm = _clean(row[csm_col])
        product = ""
        if product_col is not None and product_col < len(row):
            product = str(row[product_col] or "").strip().lower()
        is_vini = product == "vini"
        if not csm and not is_vini:
            continue
        rank = 2 if is_vini else 1
        _remember(ranked_id, enterprise_id, csm, rank)
        if name_col is not None and name_col < len(row):
            customer = " ".join(str(row[name_col] or "").lower().split())
            _remember(ranked_name, customer, csm, rank)
    return {
        "by_id": {key: value[1] for key, value in ranked_id.items() if value[1]},
        "by_name": {key: value[1] for key, value in ranked_name.items() if value[1]},
    }


def fetch_csm_lookup(url: str | None = None) -> dict[str, dict[str, str]]:
    target = url or os.environ.get("CSM_CSV_URL") or PUBLIC_CSM_CSV
    request = urllib.request.Request(target, headers={"User-Agent": "vini-accounts-alert/2026-10-16"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    text = raw.decode("utf-8-sig", errors="replace")
    if text.lstrip().startswith("<") or text.lstrip().startswith("{"):
        raise RuntimeError("The CSM tab did not come back as CSV.")
    return parse_csm_table(text)


def apply_csm(alert_rows: list[dict], lookup: dict[str, dict[str, str]]) -> list[dict]:
    """Set CSM from an exact enterprise id match. No match becomes blank.

    Customer name, the Alerts column I value, and a guessed name are not used.
    """
    by_id = lookup.get("by_id") or {}
    for row in alert_rows:
        enterprise_id = str(row.get("enterprise_id") or "").strip()
        row["CSM"] = by_id.get(enterprise_id) or ""
    return alert_rows
