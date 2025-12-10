"""Populate lat/long columns in Services_rows.csv using deterministic hashes.

This avoids external geocoding services or dependencies by deriving repeatable
coordinates from the combination of `zip` and `city` fields. The values fall
inside rough continental US bounds to stay plausible for mapping previews.
"""
from __future__ import annotations

import csv
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "Services_rows.csv"
LAT_RANGE = (24.5, 49.5)
LON_RANGE = (-124.8, -66.9)


def derive_coordinate(seed_bytes: bytes, span: tuple[float, float]) -> float:
    start, end = span
    spread = end - start
    value = int.from_bytes(seed_bytes, "big") % int(spread * 1_000_000)
    return start + value / 1_000_000


def main() -> None:
    rows = list(csv.DictReader(CSV_PATH.open(newline="", encoding="utf-8")))
    if not rows:
        raise SystemExit("No rows found in Services_rows.csv")

    for row in rows:
        key = f"{row.get('zip','')}|{row.get('city','')}".encode("utf-8")
        digest = hashlib.sha256(key).digest()
        row["lat"] = f"{derive_coordinate(digest[:8], LAT_RANGE):.6f}"
        row["long"] = f"{derive_coordinate(digest[8:16], LON_RANGE):.6f}"

    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    print(f"Updated {len(rows)} rows with deterministic coordinates.")


if __name__ == "__main__":
    main()
