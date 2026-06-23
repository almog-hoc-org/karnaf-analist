"""
Import national quarterly completions from
"נתוני סיום בנייה לפי רבעון 10 שנים.pdf" (published 19/03/2026).

The PDF lists 40 rows ordered 2016→2025 (top to bottom),
4 quarters each. We sum to annual totals and update national_construction.
"""
import fitz
import sqlite3
import os
import re
from pathlib import Path

PDF_PATH = Path("data/נתוני סיום בנייה לפי רבעון 10 שנים.pdf")
DB_PATH = Path("data/realestate.db")

def main():
    doc = fitz.open(PDF_PATH)
    text = doc[0].get_text()
    # The first numeric column ("נתונים מקוריים", raw data) is the one we want.
    # Pattern: each row is 3 numbers (raw / seasonal / trend), preceded by quarter "1..4".
    # We'll capture all standalone numeric lines and take every 3rd (the raw).
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    # Find the section after the header. Numbers >= 1000 with commas are the data rows.
    nums = []
    for l in lines:
        if re.match(r"^\d{1,3}(?:,\d{3})+$", l):
            nums.append(int(l.replace(",", "")))
    # 40 quarters × 3 columns = 120 numbers
    if len(nums) < 120:
        print(f"⚠  Expected ≥120 numeric values, got {len(nums)}")
        return
    raw = nums[0:120:3]  # every third value starting at 0 = raw column
    if len(raw) != 40:
        print(f"⚠  Expected 40 raw values, got {len(raw)}")
        return

    annual = {}
    for i, val in enumerate(raw):
        year = 2016 + i // 4
        annual[year] = annual.get(year, 0) + val

    print("Annual completions (from PDF, 2016→2025):")
    for y in sorted(annual):
        print(f"  {y}: {annual[y]:,}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='national_construction'")
    if not cur.fetchone():
        print("national_construction table not found")
        return

    # Update existing rows; insert if missing.
    for year, completions in annual.items():
        cur.execute("SELECT id, permits, starts, source FROM national_construction WHERE year=?", (year,))
        row = cur.fetchone()
        if row:
            _id, permits, starts, source = row
            cur.execute(
                "UPDATE national_construction SET completions=?, source=COALESCE(?, '') || '+cbs_completions_pdf_2026' WHERE id=?",
                (completions, source.replace("+cbs_completions_pdf", "").replace("cbs_completions_pdf", "") if source else "", _id),
            )
        else:
            cur.execute(
                "INSERT INTO national_construction (year, completions, source) VALUES (?, ?, 'cbs_completions_pdf_2026')",
                (year, completions),
            )
    conn.commit()
    conn.close()
    print("✅ national_construction updated.")

if __name__ == "__main__":
    main()
