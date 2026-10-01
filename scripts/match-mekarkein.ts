#!/usr/bin/env tsx
/**
 * Match our deals to the tax authority's register (mekarkein_deals, loaded by
 * scripts/import-mekarkein-deals.ts), then give deals that now have a parcel
 * but no street the address of the other deals in that parcel.
 *
 *   npx tsx scripts/match-mekarkein.ts --city "חולון" --dry-run   measure one city, write nothing
 *   npx tsx scripts/match-mekarkein.ts --city "חולון"             write one city
 *   npx tsx scripts/match-mekarkein.ts                            every city the register covers
 *
 * WHAT IT WRITES (UPDATE only, never INSERT, never overwrite):
 *   nadlan_transactions.parcel_num   = COALESCE(parcel_num, <register parcel>)
 *   nadlan_transactions.mekarkein_id = <register row id>
 *   nadlan_transactions.street/house_num, only where the street is empty and
 *     every deal in the same flat (or, failing that, the same parcel) agrees.
 *
 * THE SAFETY GATE. ~250k of our rows already carry a parcel from the nadlan
 * capture. A match that disagrees with it is a wrong match, so those rows are
 * the accuracy measurement, per city. A city whose contradiction rate is above
 * MAX_CONFLICT_RATE (with at least MIN_CONTROL control rows) is reported and
 * NOT written: a wrong parcel moves a deal to another building.
 */
import Database from "better-sqlite3";
import path from "path";
import { matchCity, inheritAddresses, type MekarkeinRow, type OurDeal } from "../lib/mekarkein";
import { ensureMekarkeinTables, ensureMekarkeinIdColumn } from "../lib/mekarkeinDb";
import { ensureNadlanAddressColumnsSync } from "../lib/addressBackfillDb";

const MAX_CONFLICT_RATE = 0.02;
const MIN_CONTROL = 50;

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const cityArg = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;

// The nightly collector passes --nightly. Until the operator turns the source
// on (after writing to the publisher), a nightly run is a no-op that says so.
if (args.includes("--nightly") && process.env.KARNAF_MEKARKEIN_ENABLED !== "1") {
  console.log("↷ מיסוי מקרקעין כבוי — KARNAF_MEKARKEIN_ENABLED=1 ב-.env.production מפעיל אותו");
  process.exit(0);
}
const DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");

interface CityReport {
  city: string; ours: number; register: number;
  matched: number; exact: number; rounded: number; shifted: number;
  confirmed: number; conflicts: number; ambiguous: number; unmatched: number;
  newParcels: number; inherited: number; inheritAmbiguous: number; written: boolean; note?: string;
}

function main() {
  const db = new Database(DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 60000");
  ensureMekarkeinTables(db);
  ensureNadlanAddressColumnsSync(db);
  ensureMekarkeinIdColumn(db);
  db.exec(`CREATE TABLE IF NOT EXISTS mekarkein_match_status (
    city_name TEXT NOT NULL, run_at DATETIME DEFAULT CURRENT_TIMESTAMP, dry INTEGER NOT NULL,
    ours INTEGER, register INTEGER, matched INTEGER, exact INTEGER, rounded INTEGER, shifted INTEGER,
    confirmed INTEGER, conflicts INTEGER, ambiguous INTEGER, unmatched INTEGER,
    new_parcels INTEGER, inherited INTEGER, inherit_ambiguous INTEGER, written INTEGER, note TEXT)`);

  const cities = cityArg
    ? [cityArg]
    : (db.prepare(`SELECT city_name FROM mekarkein_deals WHERE city_name IS NOT NULL
                    GROUP BY city_name ORDER BY COUNT(*) DESC`).all() as Array<{ city_name: string }>).map((r) => r.city_name);
  if (!cities.length) { console.log("✗ mekarkein_deals ריקה — להריץ קודם scripts/import-mekarkein-deals.ts"); return; }
  console.log(`▸ התאמה למיסוי מקרקעין · ${cities.length} ערים${dry ? " · יבש, לא נכתב דבר" : ""}\n`);

  const loadOurs = db.prepare(`SELECT id, deal_date dealDate, price, area, rooms, parcel_num parcelNum, captured_at capturedAt
      FROM nadlan_transactions WHERE city_name = ? AND price > 0 AND mekarkein_id IS NULL`);
  // The last run that wrote this city: pairs older than it were already judged
  // there (lib/mekarkein.ts matchCity, isNew).
  const lastWritten = db.prepare(`SELECT MAX(run_at) m FROM mekarkein_match_status
      WHERE city_name = ? AND dry = 0 AND written = 1`);
  // captured_at is a Prisma DateTime: epoch milliseconds when Prisma wrote the
  // row, SQLite's "YYYY-MM-DD HH:MM:SS" when raw SQL took the column default.
  // run_at / imported_at are the latter. Compare all three in that form (UTC).
  const ts = (v: unknown): string => {
    if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString().replace("T", " ").slice(0, 19);
    if (typeof v === "string") return /^\d+$/.test(v) ? ts(Number(v)) : v.replace("T", " ").slice(0, 19);
    return "";
  };
  const loadReg = db.prepare(`SELECT id, settlement, settlement_code settlementCode, gush, helka, sub, deal_date dealDate,
      amount, declared_amount declaredAmount, nature, portion, area, rooms, year_built yearBuilt, first_seen firstSeen,
      imported_at importedAt
      FROM mekarkein_deals WHERE city_name = ?`);
  const setParcel = db.prepare(`UPDATE nadlan_transactions SET parcel_num = COALESCE(parcel_num, ?), mekarkein_id = ? WHERE id = ?`);
  const loadAddr = db.prepare(`SELECT id, parcel_num parcelNum, street, house_num houseNum
      FROM nadlan_transactions WHERE city_name = ?`);
  const setAddr = db.prepare(`UPDATE nadlan_transactions SET street = ?, house_num = COALESCE(NULLIF(TRIM(house_num), ''), ?)
      WHERE id = ? AND (street IS NULL OR TRIM(street) = '')`);
  const logRun = db.prepare(`INSERT INTO mekarkein_match_status
      (city_name, dry, ours, register, matched, exact, rounded, shifted, confirmed, conflicts, ambiguous, unmatched,
       new_parcels, inherited, inherit_ambiguous, written, note)
      VALUES (@city, @dry, @ours, @register, @matched, @exact, @rounded, @shifted, @confirmed, @conflicts, @ambiguous,
       @unmatched, @newParcels, @inherited, @inheritAmbiguous, @written, @note)`);

  const reports: CityReport[] = [];
  for (const city of cities) {
    const ours = loadOurs.all(city) as OurDeal[];
    const reg = loadReg.all(city) as MekarkeinRow[];
    const since = (lastWritten.get(city) as { m: string | null }).m;
    const m = matchCity(ours, reg, 2, since ? (d, r) => ts(r.importedAt) > since || ts(d.capturedAt) > since : undefined);
    const control = m.confirmed + m.conflicts;
    const conflictRate = control ? m.conflicts / control : 0;
    const blocked = control >= MIN_CONTROL && conflictRate > MAX_CONFLICT_RATE;
    const heldParcel = new Set(ours.filter((o) => o.parcelNum).map((o) => o.id));
    const r: CityReport = {
      city, ours: ours.length, register: reg.length, matched: m.matches.length,
      exact: m.matches.filter((x) => x.level === "exact").length,
      rounded: m.matches.filter((x) => x.level === "rounded").length,
      shifted: m.matches.filter((x) => x.level === "shifted").length,
      confirmed: m.confirmed, conflicts: m.conflicts, ambiguous: m.ambiguous, unmatched: m.unmatched,
      newParcels: m.matches.filter((x) => !heldParcel.has(x.ourId)).length,
      inherited: 0, inheritAmbiguous: 0, written: false,
      note: blocked ? `סתירות ${(conflictRate * 100).toFixed(1)}% מעל ${MAX_CONFLICT_RATE * 100}% — העיר לא נכתבה` : undefined,
    };

    if (!dry && !blocked) {
      db.transaction(() => { for (const x of m.matches) setParcel.run(x.parcel, x.regId, x.ourId); })();
    }
    // Inheritance reads parcels as they now stand. In a dry run the new
    // parcels exist only in memory, so they are laid over the rows (with the
    // rows' own street and house) — the count is then exactly what a write
    // would do. A blocked city gets no new parcels either way.
    const all = loadAddr.all(city) as Array<{ id: number; parcelNum: string | null; street: string | null; houseNum: string | null }>;
    if (dry && !blocked) {
      const newParcel = new Map(m.matches.map((x) => [x.ourId, x.parcel]));
      for (const row of all) if (!row.parcelNum && newParcel.has(row.id)) row.parcelNum = newParcel.get(row.id)!;
    }
    const inh = inheritAddresses(all.filter((row) => row.parcelNum));
    r.inherited = blocked ? 0 : inh.fills.length;
    r.inheritAmbiguous = inh.ambiguous;
    if (!dry && !blocked) {
      db.transaction(() => { for (const f of inh.fills) setAddr.run(f.street, f.houseNum, f.id); })();
      r.written = true;
    }
    logRun.run({ ...r, dry: dry ? 1 : 0, written: r.written ? 1 : 0, note: r.note ?? null });
    reports.push(r);

    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
    console.log(
      `${blocked ? "✗" : "✓"} ${city}: ${r.matched.toLocaleString("he-IL")} הותאמו מתוך ${r.ours.toLocaleString("he-IL")} (${pct(r.matched, r.ours)})` +
      ` · מדויק ${r.exact} · מעוגל ${r.rounded} · יום הזזה ${r.shifted}` +
      ` · בקרה: ${r.confirmed} אושרו, ${r.conflicts} סותרות (${pct(r.conflicts, control)})` +
      (m.stale ? ` · ${m.stale} סתירות ישנות נראו שוב (לא נספרו)` : "") +
      ` · דו-משמעי ${r.ambiguous} · +${r.newParcels.toLocaleString("he-IL")} גוש-חלקה · +${r.inherited.toLocaleString("he-IL")} כתובות (${r.inheritAmbiguous} דו-משמעיות)` +
      (r.note ? `\n    ${r.note}` : "")
    );
  }

  const sum = (k: keyof CityReport) => reports.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  console.log(`\nסה״כ: ${sum("matched").toLocaleString("he-IL")} הותאמו · +${sum("newParcels").toLocaleString("he-IL")} גוש-חלקה · +${sum("inherited").toLocaleString("he-IL")} כתובות · ${reports.filter((r) => r.note).length} ערים נחסמו${dry ? " · יבש" : ""}`);
  if (!dry && sum("inherited") > 0) console.log("הצינור הלילי יפיץ את הכתובות לעמודי הרחוב, הבניין, החיפוש והנעצים.");
}

main();
