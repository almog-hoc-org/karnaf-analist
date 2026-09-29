#!/usr/bin/env tsx
/**
 * Where the tax register (over.org.il) stands on this server — read only.
 * Printed in the deploy log, so the nightly import and match can be checked
 * without a shell on the host. See docs/MEKARKEIN.md.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
const DB = path.join(DATA_DIR, "realestate.db");
const n = (x: number | null | undefined) => (x == null ? "—" : Number(x).toLocaleString("he-IL"));
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}GB`;

function main() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    console.log(`   דיסק: ${gb(s.bavail * s.bsize)} פנויים · realestate.db ${gb(fs.statSync(DB).size)}`);
  } catch { /* not fatal */ }

  const db = new Database(DB, { readonly: true, fileMustExist: true });
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has("mekarkein_deals")) { console.log("   הפנקס עוד לא נטען (ריצה ראשונה בלילה, 03:30)"); return; }

  const tot = db.prepare("SELECT COUNT(*) c, MAX(deal_date) last, SUM(city_name IS NOT NULL) mapped FROM mekarkein_deals").get() as { c: number; last: string | null; mapped: number };
  console.log(`   פנקס: ${n(tot.c)} שורות · ${n(tot.mapped)} משויכות לעיר שלנו · עסקה אחרונה ${tot.last ?? "—"}`);
  if (has("mekarkein_import_status")) {
    const r = db.prepare("SELECT run_at, mode, rows_read, rows_new, rows_unmapped FROM mekarkein_import_status ORDER BY id DESC LIMIT 1").get() as
      { run_at: string; mode: string; rows_read: number; rows_new: number; rows_unmapped: number } | undefined;
    if (r) console.log(`   ייבוא אחרון: ${r.run_at} · ${r.mode} · נקראו ${n(r.rows_read)} · חדשות ${n(r.rows_new)} · בלי עיר ${n(r.rows_unmapped)}`);
  }

  if (!has("mekarkein_match_status")) { console.log("   התאמה: עוד לא רצה"); return; }
  const last = db.prepare("SELECT MAX(run_at) m FROM mekarkein_match_status WHERE dry = 0").get() as { m: string | null };
  if (!last.m) { console.log("   התאמה: רק ריצות יבשות עד כה"); return; }
  // the latest written row per city
  const rows = db.prepare(`
    SELECT s.* FROM mekarkein_match_status s
    JOIN (SELECT city_name, MAX(run_at) m FROM mekarkein_match_status WHERE dry = 0 GROUP BY city_name) x
      ON x.city_name = s.city_name AND x.m = s.run_at AND s.dry = 0`).all() as Array<{
    city_name: string; ours: number; matched: number; confirmed: number; conflicts: number;
    new_parcels: number; inherited: number; written: number; note: string | null;
  }>;
  const sum = (k: "ours" | "matched" | "confirmed" | "conflicts" | "new_parcels" | "inherited") => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const control = sum("confirmed") + sum("conflicts");
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
  console.log(`   התאמה (ריצה אחרונה ${last.m}): ${rows.length} ערים · הותאמו ${n(sum("matched"))} מתוך ${n(sum("ours"))} (${pct(sum("matched"), sum("ours"))})` +
    ` · סתירות ${pct(sum("conflicts"), control)} · +${n(sum("new_parcels"))} גוש-חלקה · +${n(sum("inherited"))} כתובות` +
    ` · נחסמו ${rows.filter((r) => !r.written).length}`);
  const holon = rows.find((r) => r.city_name === "חולון");
  if (holon) {
    console.log(`   חולון: הותאמו ${n(holon.matched)} מתוך ${n(holon.ours)} (${pct(holon.matched, holon.ours)}) · סתירות ${pct(holon.conflicts, holon.confirmed + holon.conflicts)}` +
      ` · +${n(holon.new_parcels)} גוש-חלקה · +${n(holon.inherited)} כתובות${holon.note ? ` · ${holon.note}` : ""}`);
  }
  for (const r of rows.filter((x) => !x.written).slice(0, 10)) console.log(`   ✗ ${r.city_name}: ${r.note ?? "לא נכתבה"}`);
  if (has("mekarkein_promote_status")) {
    const p = db.prepare("SELECT COUNT(*) c, SUM(inserted) ins FROM mekarkein_promote_status").get() as { c: number; ins: number | null };
    if (p.c) console.log(`   עסקאות חדשות מהפנקס: ${n(p.ins)} נוספו בסך הכל`);
  }
}

try { main(); } catch (e) { console.log(`   ⚠ הדוח נכשל: ${e instanceof Error ? e.message : String(e)}`); }
