#!/usr/bin/env tsx
/**
 * Render a city page the way a SIGNED-IN visitor renders it, and report what
 * came back — status, digest, and whether it was the error screen.
 *
 * WHY THIS EXISTS
 * "Application error: a server-side exception has occurred. Digest: 1896103521"
 * is all the browser will ever say. A digest is a hash of the message, not the
 * message. Two things have to be true to turn it into a name:
 *
 *   1. The request must be AUTHENTICATED and the city UNLOCKED. Anonymous
 *      requests stop at the public summary — a completely different, much
 *      shorter render path — so curling the URL from outside cannot reproduce a
 *      crash that lives past the wall. This is why the operator saw an error
 *      the page checks never did.
 *   2. The request must run against the LIVE database. The build DB is empty
 *      and every loader returns nothing, which is exactly the shape of input
 *      that does not crash.
 *
 * So: create a throwaway user + session directly in app.db, insert the unlock
 * row directly (no credits spent), fetch over loopback, then delete all three.
 * The real stack trace lands on the container's stdout, where the deploy
 * workflow dumps it in the step right after this one.
 *
 * The probe user is deleted in a finally block and its email is not a valid
 * address, so a crash mid-run cannot leave a usable login behind.
 *
 * Run inside the container:
 *   npx tsx scripts/probe-city-page.ts "מגדל העמק" "חיפה"
 *   npx tsx scripts/probe-city-page.ts --all      (every city — slow, thorough)
 */
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";

const BASE = process.env.PROBE_BASE_URL ?? "http://127.0.0.1:3000";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_DB = path.join(process.cwd(), "data", "app.db");
const RE_DB = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data", "realestate.db");
const PROBE_EMAIL = "probe@karnaf.invalid";

interface Result { city: string; status: number; digest: string | null; bytes: number; error: boolean }

async function fetchCity(city: string, cookie: string): Promise<Result> {
  const url = `${BASE}${BASE_PATH}/city/${encodeURIComponent(city)}`;
  const res = await fetch(url, { headers: { cookie }, redirect: "follow" });
  const body = await res.text();
  // Next's client error screen and the RSC error payload both carry the digest.
  const digest = body.match(/[Dd]igest:?\s*"?(\d{6,})"?/)?.[1] ?? null;
  const error = res.status >= 500 || /server-side exception|Application error/i.test(body);
  return { city, status: res.status, digest, bytes: body.length, error };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: probe-city-page.ts "<city>" [...] | --all');
    process.exit(2);
  }

  let cities: string[];
  if (args[0] === "--all") {
    const re = new Database(RE_DB, { readonly: true });
    cities = (re.prepare("SELECT city_name FROM cities ORDER BY city_name").all() as Array<{ city_name: string }>)
      .map((r) => r.city_name);
    re.close();
  } else {
    cities = args;
  }

  const db = new Database(APP_DB);
  db.pragma("busy_timeout = 15000");
  const token = crypto.randomBytes(32).toString("hex");
  let userId: number | null = null;

  try {
    db.prepare("DELETE FROM users WHERE email=?").run(PROBE_EMAIL);
    userId = Number(
      db.prepare(
        "INSERT INTO users (email, name, password_hash, salt, tier) VALUES (?, 'probe', '-', '-', 'free')"
      ).run(PROBE_EMAIL).lastInsertRowid
    );
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now','+1 hour'))")
      .run(token, userId);
    const ins = db.prepare(
      "INSERT OR REPLACE INTO city_unlocks (user_id, city_name, expires_at) VALUES (?, ?, datetime('now','+1 hour'))"
    );
    db.transaction(() => { for (const c of cities) ins.run(userId, c); })();

    const cookie = `karnaf_session=${token}`;
    console.log(`בדיקת ${cities.length} עמודי עיר כמשתמש מחובר (${BASE})\n`);

    const failures: Result[] = [];
    for (const city of cities) {
      let r: Result;
      try {
        r = await fetchCity(city, cookie);
      } catch (e) {
        r = { city, status: 0, digest: null, bytes: 0, error: true };
        console.log(`  ✗ ${city}: ${e instanceof Error ? e.message : String(e)}`);
        failures.push(r);
        continue;
      }
      if (r.error) {
        failures.push(r);
        console.log(`  ✗ ${city}: HTTP ${r.status}${r.digest ? ` · digest ${r.digest}` : ""}`);
      } else if (cities.length <= 5) {
        console.log(`  ✓ ${city}: HTTP ${r.status} · ${Math.round(r.bytes / 1024)}KB`);
      }
    }

    console.log("");
    if (!failures.length) {
      console.log(`✓ כל ${cities.length} העמודים נטענו`);
      return;
    }
    console.log(`✗ ${failures.length}/${cities.length} עמודים נכשלו:`);
    const byDigest = new Map<string, string[]>();
    for (const f of failures) {
      const k = `${f.status}${f.digest ? ` · digest ${f.digest}` : ""}`;
      byDigest.set(k, [...(byDigest.get(k) ?? []), f.city]);
    }
    for (const [k, list] of [...byDigest].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${list.length}] ${k}`);
      console.log(`      ${list.slice(0, 15).join(", ")}${list.length > 15 ? " …" : ""}`);
    }
    console.log("\nהסטאק המלא נמצא בלוג הקונטיינר — השלב הבא מדפיס אותו.");
    process.exitCode = 1;
  } finally {
    // Order matters: the FK on sessions.user_id means the session row goes
    // first. Each delete is independent — one missing table must not leave the
    // probe account alive, which is the whole point of the finally block.
    const drop = (sql: string, arg: unknown) => {
      try { db.prepare(sql).run(arg as never); } catch { /* table may not exist yet */ }
    };
    drop("DELETE FROM sessions WHERE token=?", token);
    if (userId != null) {
      drop("DELETE FROM city_unlocks WHERE user_id=?", userId);
      drop("DELETE FROM credits_ledger WHERE user_id=?", userId);
      drop("DELETE FROM users WHERE id=?", userId);
    }
    db.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
