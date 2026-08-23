#!/usr/bin/env tsx
/**
 * Fetch the REAL home page from the running server and report what the movers
 * board actually rendered.
 *
 * WHY THIS IS DIFFERENT FROM EVERY OTHER CHECK HERE, AND WHY IT EXISTS
 * "שינויי מחיר — לבחירתך" went blank on the live site while the database was
 * full: the pipeline's own diagnostic counted 63 qualifying cities on the same
 * machine, the same night. The two statements were both true, because the
 * board is not built from the database directly — it is built from a live
 * query filtered through a SIX-HOUR CACHE, and the cache was the broken part.
 *
 * Worse, the existing diagnostic could not have found it. Scripts run outside
 * the Next runtime, where lib/cache.ts deliberately falls through to the
 * uncached loader — so scripts/diagnose-gains-card.ts measures the database and
 * reports perfect health no matter what the server is serving. Its clean bill
 * of health is precisely what kept this bug alive across several rounds of
 * "fixes".
 *
 * So this one does not import a loader at all. It asks the server over HTTP,
 * exactly as a visitor does, and reads the HTML that came back. That is the
 * only vantage point from which the cache is visible.
 *
 *   npx tsx scripts/probe-home-board.ts [url]
 */
import { SERVER_FAULT_TEXT } from "../lib/moversBoard";

const URL_ = process.argv[2] ?? "http://127.0.0.1:3000/";

/** The board's own heading — proves we are looking at a page that has the card. */
const BOARD_HEADING = "שינויי מחיר — לבחירתך";
/** The hot-cities heading, checked in the same fetch since it is the same fold. */
const HOT_HEADING = "ערים חמות";

async function main(): Promise<number> {
  let html: string;
  try {
    const res = await fetch(URL_, {
      headers: { "user-agent": "karnaf-probe/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`FAIL: ${URL_} returned HTTP ${res.status}`);
      return 1;
    }
    html = await res.text();
  } catch (e) {
    console.error(`FAIL: could not fetch ${URL_} — ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  console.log(`נבדק: ${URL_}  ·  ${(html.length / 1024).toFixed(0)}KB`);

  if (!html.includes(BOARD_HEADING)) {
    console.error(`FAIL: the movers board is not on the page at all (heading "${BOARD_HEADING}" missing)`);
    return 1;
  }

  // The one message that means the fault is OURS rather than the reader's
  // filter choice. The other three empty states are legitimate outcomes of a
  // selection nobody made here, so they are not failures.
  if (html.includes(SERVER_FAULT_TEXT)) {
    console.error("FAIL: the board rendered its server-fault message —");
    console.error(`      "${SERVER_FAULT_TEXT}"`);
    console.error("      The page shipped an EMPTY city list. The database is not the suspect:");
    console.error("      check the ranking-eligibility cache (lib/cache.ts guardEmpty) and");
    console.error("      whether /api/revalidate ran after the last aggregation.");
    return 1;
  }

  // Count the rows the card actually drew. Each is a link to a city page
  // inside the board's list; counting them separates "rendered with data" from
  // "rendered with one of the other empty messages".
  const boardStart = html.indexOf(BOARD_HEADING);
  const tail = html.slice(boardStart, boardStart + 60_000);
  const rows = new Set([...tail.matchAll(/\/city\/([^"'?#]+)/g)].map((m) => decodeURIComponent(m[1])));
  console.log(`כרטיס שינויי מחיר: ${rows.size} ערים בקישורים · ${[...rows].slice(0, 6).join(", ")}`);
  if (rows.size === 0) {
    console.error("FAIL: the board is present but drew no city rows.");
    return 1;
  }

  console.log(html.includes(HOT_HEADING) ? "ערים חמות: מוצגות" : "⚠ ערים חמות: לא נמצאו בעמוד");

  console.log("\nthe home page renders the movers board with data");
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("threw:", e);
    process.exit(1);
  });
