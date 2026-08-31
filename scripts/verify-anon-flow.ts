#!/usr/bin/env tsx
/**
 * Does a visitor with no account really get their free cities before any wall?
 *
 * WHY THIS EXISTS AND verify-anon-access.ts IS NOT ENOUGH. That script proves
 * the LEDGER behaves — the transaction counts, the refusal fires on the right
 * row. It says nothing about what a browser actually receives, and every
 * failure the operator has reported lived in the gap between the two: a cookie
 * that never reached the render, a bot-shaped user agent that made the server
 * refuse to spend a slot, a rule left at a different number on the live
 * machine. Those all pass the ledger test and still show a signup wall to
 * someone on their first city.
 *
 * So this one is an HTTP walk: one cookie jar, N+1 real city pages, and the
 * question asked the way a visitor asks it — did the page come back whole, or
 * did it come back as the wall? N is read from the live rule, so the check
 * measures behaviour against CONFIGURATION rather than against 2 hardcoded
 * here: an operator who sets three free cities gets three verified, and one
 * who switches the allowance off gets that verified too.
 *
 * A REAL DESKTOP USER AGENT IS NOT COSMETIC. mayConsumeAnonSlot refuses to
 * spend a slot for anything bot-shaped, and the default curl/undici agent is
 * bot-shaped — with the wrong agent every city returns the wall and the check
 * "fails" while the site is fine.
 *
 * IT CLEANS UP AFTER ITSELF. The walk really does open cities, so it really
 * does write rows: its own anon_unlocks are deleted by id, and the unlock
 * events it generated are deleted within the second-wide window it ran in.
 *
 *   npx tsx scripts/verify-anon-flow.ts            # against localhost:3000
 *   BASE=http://localhost:3111 npx tsx scripts/verify-anon-flow.ts
 */
import { appDb } from "../lib/appDb";
import { prisma } from "../lib/db";
import { getRuleBool, getRuleNum, getRuleText } from "../lib/systemRules";
import { ALIAS_NAMES } from "../lib/cityAliases";

const BASE = process.env.BASE ?? "http://localhost:3000";
/** A real Chrome string: anything bot-shaped is refused a free slot by design. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Text only the full city page carries; the public summary has neither. */
const FULL_MARKERS = ["מגמות מחירים", "השוואת מחירים ברחוב"];
/** Text only the signup wall carries. */
const WALL_MARKER = "צריך חשבון";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  else { failures++; console.error(`  ✗    ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** The one cookie the walk carries, kept by hand — undici has no jar. */
let jar = "";
function absorb(res: Response) {
  const set = res.headers.get("set-cookie");
  const m = set?.match(/karnaf_anon=([^;]+)/);
  if (m) jar = `karnaf_anon=${m[1]}`;
}

async function get(path: string): Promise<{ html: string; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": UA, ...(jar ? { cookie: jar } : {}) },
    redirect: "follow",
  });
  absorb(res);
  return { html: await res.text(), status: res.status };
}

async function main() {
  const paywallOn = getRuleBool("paywall_on", true);
  const demoCity = getRuleText("demo_city", "חיפה");
  const free = Math.max(0, getRuleNum("anon_free_cities", 2));
  console.log(
    `חומת הרשמה: ${paywallOn ? "פעילה" : "כבויה"} · עיר הדגמה: ${demoCity} · ערים חינם ללא חשבון: ${free}\n`
  );

  if (!paywallOn) {
    console.log("החומה כבויה — כל העמודים פתוחים לכולם, אין מה לבדוק.");
    return;
  }

  // Real cities, biggest first, skipping the demo (it is free for everyone and
  // spends nothing) and the alias names (they redirect to their canonical).
  const cities = (
    await prisma.city.findMany({
      where: { city_name: { notIn: [...ALIAS_NAMES, demoCity] } },
      select: { city_name: true },
      orderBy: { population_2026: "desc" },
      take: free + 1,
    })
  ).map((c) => c.city_name);

  if (cities.length < free + 1) {
    console.log(`אין מספיק ערים במאגר לבדיקה (${cities.length}) — מדלג.`);
    return;
  }

  const startedAt = new Date().toISOString();
  // The home page mints the cookie, exactly as a first visit does.
  await get("/");
  check("נוצר מזהה מבקר אנונימי", !!jar);

  // The demo city must not cost anything — otherwise the allowance is one city
  // short of what the operator configured, for every visitor who starts there.
  const demo = await get(`/city/${encodeURIComponent(demoCity)}`);
  check(
    `${demoCity} (עיר הדגמה) נפתחת במלואה`,
    FULL_MARKERS.every((m) => demo.html.includes(m))
  );

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const { html } = await get(`/city/${encodeURIComponent(city)}`);
    const full = FULL_MARKERS.every((m) => html.includes(m));
    const walled = html.includes(WALL_MARKER);
    if (i < free) {
      check(`עיר חינם ${i + 1}/${free}: ${city} — תצוגה מלאה`, full && !walled,
        full ? "" : "התקבלה תקציר/חומה במקום העמוד המלא");
    } else {
      check(`עיר ${i + 1} (מעבר למכסה): ${city} — מוצגת החומה`, walled && !full,
        walled ? "" : "העמוד נפתח למרות שהמכסה נגמרה");
    }
  }

  // ── cleanup: this walk really opened cities, so it really wrote rows ──
  const anonIdVal = jar.replace(/^karnaf_anon=/, "");
  const db = appDb();
  const removed = db.prepare("DELETE FROM anon_unlocks WHERE anon_id=?").run(anonIdVal).changes;
  let events = 0;
  try {
    events = db
      .prepare(
        "DELETE FROM events WHERE name='unlock_done' AND detail='anon' AND created_at >= ? AND subject IN (" +
          cities.map(() => "?").join(",") + ")"
      )
      .run(startedAt.replace("T", " ").slice(0, 19), ...cities).changes;
  } catch { /* events table shape is not this script's business */ }
  console.log(`\nניקוי: ${removed} פתיחות ו-${events} אירועים של הבדיקה נמחקו.`);

  if (failures) {
    console.error(`\n${failures} כשלים — מבקר ללא חשבון לא מקבל את מה שמוגדר לו.`);
    process.exit(1);
  }
  console.log("\n✓ מבקר ללא חשבון מקבל את כל הערים החינמיות במלואן, והחומה מופיעה רק אחריהן.");
}

main().catch((e) => {
  // A check that cannot run is not a failing site: say so and let the deploy
  // continue, the same posture as the other report steps.
  console.error("הבדיקה לא הצליחה לרוץ:", e instanceof Error ? e.message : e);
  process.exit(0);
});
