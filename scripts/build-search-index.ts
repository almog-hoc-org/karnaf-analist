#!/usr/bin/env tsx
/**
 * Build the hood/street search index — pipeline stage, after the aggregation.
 *
 * Two sources, one table:
 *   hood rows   — every neighbourhood that has a page (= exists in
 *                 neighborhood_year_stats), ranked by its deal volume.
 *   street rows — every street whose deals OVERWHELMINGLY (≥70%, ≥5 deals)
 *                 carry one neighbourhood, pointing at that neighbourhood's
 *                 page. A street split between hoods is deliberately absent:
 *                 the search box must not answer "תקוע" with a guess.
 *
 * Street targets are constrained to hoods that actually have a page — a
 * street resolving to a below-floor hood would suggest a dead end.
 *
 * Rebuilt from scratch on every run (delete + insert, one transaction):
 * the index is derived data with no history worth keeping.
 *
 *   npx tsx scripts/build-search-index.ts
 */
import Database from "better-sqlite3";
import path from "path";
import { cleanStreetName, pickModalHood, searchNorm } from "../lib/searchIndex";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

function main(): number {
  const db = new Database(DB);
  db.pragma("busy_timeout = 60000");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        city_name TEXT NOT NULL,
        name TEXT NOT NULL,
        norm TEXT NOT NULL,
        hood TEXT NOT NULL,
        n INTEGER NOT NULL,
        UNIQUE(kind, city_name, name)
      );
      CREATE INDEX IF NOT EXISTS idx_search_norm ON search_index(norm);
    `);

    // ── hoods: the page inventory itself ──
    let hoods: Array<{ city_name: string; neighborhood: string; total: number }> = [];
    try {
      hoods = db.prepare(
        `SELECT city_name, neighborhood, SUM(n) total
           FROM neighborhood_year_stats
          WHERE scope = 'secondhand' AND room_bucket = 'all'
          GROUP BY city_name, neighborhood`
      ).all() as typeof hoods;
    } catch { /* aggregation has not run — empty index is correct */ }

    const hoodSet = new Set(hoods.map((h) => `${h.city_name}|${h.neighborhood}`));

    // ── streets: modal-majority assignment over the deals ──
    let streetRows: Array<{ city_name: string; street: string; neighborhood: string; n: number }> = [];
    try {
      streetRows = db.prepare(
        `SELECT city_name, street, neighborhood, COUNT(*) n
           FROM nadlan_transactions
          WHERE street IS NOT NULL AND street != ''
            AND neighborhood IS NOT NULL AND neighborhood != ''
            AND COALESCE(excluded, 0) = 0
          GROUP BY city_name, street, neighborhood`
      ).all() as typeof streetRows;
    } catch { /* table missing — dev DB */ }

    // Fold house-number variants of the same street together BEFORE the
    // majority vote, or "הרצל 12" and "הרצל 14" would each vote alone.
    const byStreet = new Map<string, Map<string, number>>();
    for (const r of streetRows) {
      const street = cleanStreetName(r.street);
      if (!street || street.length < 2) continue;
      const key = `${r.city_name}|${street}`;
      let counts = byStreet.get(key);
      if (!counts) { counts = new Map(); byStreet.set(key, counts); }
      counts.set(r.neighborhood, (counts.get(r.neighborhood) ?? 0) + Number(r.n));
    }

    let streetKept = 0, streetSplit = 0, streetNoPage = 0;
    const streetOut: Array<{ city: string; name: string; hood: string; n: number }> = [];
    for (const [key, counts] of byStreet) {
      const [city, street] = key.split("|");
      const modal = pickModalHood(counts);
      if (!modal) { streetSplit++; continue; }
      if (!hoodSet.has(`${city}|${modal.hood}`)) { streetNoPage++; continue; }
      streetOut.push({ city, name: street, hood: modal.hood, n: modal.n });
      streetKept++;
    }

    const write = db.transaction(() => {
      db.prepare("DELETE FROM search_index").run();
      const ins = db.prepare(
        "INSERT OR IGNORE INTO search_index (kind, city_name, name, norm, hood, n) VALUES (?,?,?,?,?,?)"
      );
      for (const h of hoods)
        ins.run("hood", h.city_name, h.neighborhood, searchNorm(h.neighborhood), h.neighborhood, Number(h.total));
      for (const st of streetOut)
        ins.run("street", st.city, st.name, searchNorm(st.name), st.hood, st.n);
    });
    write();

    console.log(
      `search-index: ${hoods.length} שכונות · ${streetKept} רחובות ` +
      `(נדחו: ${streetSplit} חצויים/דלים, ${streetNoPage} מצביעים על שכונה בלי עמוד)`
    );
    return 0;
  } finally {
    db.close();
  }
}

process.exit(main());

export {};
