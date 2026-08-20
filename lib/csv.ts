"use client";

/**
 * Download a table as CSV.
 *
 * THE BOM IS NOT OPTIONAL. Excel on Windows decides a CSV's encoding by
 * sniffing, and without a UTF-8 byte-order mark it reads Hebrew as mojibake —
 * every export from this dashboard would open as gibberish for the one person
 * who uses it. Three bytes, and the file works.
 *
 * Lives in lib/ rather than inside a panel because five tabs now export, and
 * the version that was copied would be the one that lost the BOM.
 */
export function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
