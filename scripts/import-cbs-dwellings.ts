#!/usr/bin/env tsx
/**
 * Load the CBS dwelling-stock table (data/cbs-dwellings-2025.json) into `cities`.
 *
 * WHY A STAGE AND NOT A ONE-OFF
 * `total_apartments` and `people_per_apartment` are read by the city page, the
 * insights engine and the rankings, and until now nothing wrote them on a
 * schedule — they carried whatever a long-ago import left behind, with no year
 * attached, so nobody could tell a 2019 figure from a current one by looking.
 * Running this every night makes the published source the definition of those
 * columns rather than a thing that happened to them once.
 *
 * WHAT IT WILL NOT DO
 *   · It will not blank a city the table does not cover. The source is only
 *     settlements of 50,000+ (40 of them); everything else keeps what it has.
 *   · It will not touch avg_household_size_2022. Persons-per-DWELLING and
 *     household SIZE are different measurements — the first counts empty and
 *     investment flats in its denominator — and the supply/demand model needs
 *     the second. Conflating them would quietly change every gap calculation.
 *   · It will not overwrite a population column. The site's population fields
 *     have their own sources and cadence; this one records the population the
 *     RATIO was computed from, so the ratio can always be re-derived.
 *
 * Idempotent. Run: npx tsx scripts/import-cbs-dwellings.ts [--dry-run]
 */
import Database from "better-sqlite3";
import path from "path";
import { dwellingsFile } from "../lib/dwellings";
import { normalizeCity, canonicalCityName, ALIAS_NAMES } from "../lib/cityAliases";

const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

function main() {
  const dry = process.argv.includes("--dry-run");
  const file = dwellingsFile();
  if (!file) {
    console.error("✗ data/cbs-dwellings-2025.json לא נמצא או פגום");
    process.exit(1);
  }

  const db = new Database(DB);
  db.pragma("busy_timeout = 30000");

  try {
    // Provenance columns. The values are useless without the year they describe
    // — that is the whole reason the previous figures could not be trusted.
    for (const ddl of [
      "ALTER TABLE cities ADD COLUMN dwellings_year INTEGER",
      "ALTER TABLE cities ADD COLUMN dwellings_population INTEGER",
    ]) {
      try { db.exec(ddl); } catch { /* already present */ }
    }

    const known = (db.prepare("SELECT city_name FROM cities").all() as Array<{ city_name: string }>)
      .map((r) => r.city_name);
    // Match through the alias/spelling folder — the published table writes
    // "הרצלייה" and "תל אביב -יפו", neither of which is our stored spelling.
    //
    // ALIAS ROWS LOSE ON PURPOSE. `cities` still carries legacy rows whose
    // names are aliases ("מכבים רעות"), and canonicalCityName folds those onto
    // the SAME key as the real row ("מודיעין-מכבים-רעות" → "מודיעין מכבים
    // רעות"). Map keeps the last writer, so without this filter the import
    // silently wrote the city's dwelling figures to the alias row and left the
    // row the site actually reads untouched — a no-op that reports success.
    const aliasKeys = new Set(ALIAS_NAMES.map((a) => normalizeCity(a)));
    const canonicalFirst = [...known].sort(
      (a, b) => Number(aliasKeys.has(normalizeCity(a))) - Number(aliasKeys.has(normalizeCity(b)))
    );
    const lookup = new Map<string, string>();
    for (const c of canonicalFirst) {
      const key = normalizeCity(canonicalCityName(c));
      if (!lookup.has(key)) lookup.set(key, c); // first wins → the canonical row
    }

    const upd = db.prepare(
      `UPDATE cities
          SET total_apartments = ?, people_per_apartment = ?,
              dwellings_year = ?, dwellings_population = ?
        WHERE city_name = ?`
    );

    let updated = 0, unchanged = 0;
    const missing: string[] = [];
    const changes: string[] = [];

    const apply = db.transaction(() => {
      for (const row of file.cities) {
        const stored = lookup.get(normalizeCity(canonicalCityName(row.city)));
        if (!stored) { missing.push(row.city); continue; }

        const before = db.prepare(
          "SELECT total_apartments a, people_per_apartment p FROM cities WHERE city_name=?"
        ).get(stored) as { a: number | null; p: number | null };

        const same =
          before?.a != null && Math.round(before.a) === row.dwellings &&
          before?.p != null && Math.abs(before.p - row.ratio) < 0.005;
        if (same) { unchanged++; continue; }

        if (!dry) upd.run(row.dwellings, row.ratio, file.source.dwellingsYear, row.population, stored);
        updated++;
        changes.push(
          `  ${stored}: דירות ${before?.a == null ? "—" : Math.round(before.a).toLocaleString("he-IL")} → ` +
          `${row.dwellings.toLocaleString("he-IL")} · נפשות לדירה ` +
          `${before?.p == null ? "—" : before.p.toFixed(2)} → ${row.ratio.toFixed(2)}`
        );
      }
    });
    apply();

    console.log(
      `import-cbs-dwellings${dry ? " [יבש]" : ""}: ${updated} ערים עודכנו · ${unchanged} כבר תואמות · ` +
      `${missing.length} לא נמצאו במאגר`
    );
    for (const c of changes.slice(0, 40)) console.log(c);
    if (changes.length > 40) console.log(`  … ועוד ${changes.length - 40}`);
    if (missing.length) {
      console.log(`  ערים מהפרסום שאין להן שורה במאגר: ${missing.join(", ")}`);
    }
    console.log(
      `  ארצי: ${file.national.wholeCountry.ratio} נפשות לדירה · ` +
      `ערים מעל 50 אלף: ${file.national.citiesOver50k.ratio}`
    );
  } finally {
    db.close();
  }
}

main();
