#!/usr/bin/env tsx
/**
 * Prove the free anonymous allowance actually behaves like an allowance.
 *
 * WHY A SCRIPT AND NOT A UNIT TEST
 * Same reason as verify-usage-queries.ts: this is SQL and a transaction. `tsc`
 * confirms the shapes and says nothing about whether the statement parses,
 * whether the ON CONFLICT clause fires, or whether the transaction holds the
 * count consistent — and the failure mode here is the expensive kind. A gate
 * that silently opens gives the whole site away; a gate that silently closes
 * shows a registration wall to a first-time visitor on their FIRST city, which
 * is exactly the thing this feature exists to remove. Neither throws.
 *
 * It writes to app.db under a clearly-marked throwaway id and deletes it on the
 * way out, including if an assertion fails.
 *
 *   npx tsx scripts/verify-anon-access.ts
 */
import { appDb } from "../lib/appDb";
import {
  anonFreeCities, tryAnonUnlock, isAnonCityUnlocked, anonUnlockedCities,
  claimAnonUnlocks, isValidAnonId, mayConsumeAnonSlot,
} from "../lib/anonAccess";

const ID = "verify-anon-access-throwaway-id";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function cleanup() {
  try {
    appDb().prepare("DELETE FROM anon_unlocks WHERE anon_id=?").run(ID);
    appDb().prepare("DELETE FROM city_unlocks WHERE user_id=?").run(999999999);
  } catch { /* table may not exist on a fresh DB — nothing to clean */ }
}

function main() {
  const limit = anonFreeCities();
  console.log(`anon_free_cities = ${limit}`);

  // The pure guards first — they need no database and gate everything else.
  check("a Next prefetch never spends a slot", !mayConsumeAnonSlot({ prefetch: "1" }));
  check("a purpose:prefetch header never spends a slot", !mayConsumeAnonSlot({ purpose: "prefetch" }));
  check("a crawler never spends a slot", !mayConsumeAnonSlot({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }));
  check("a real browser does", mayConsumeAnonSlot({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1" }));
  check("a junk cookie value is rejected", !isValidAnonId("../../etc/passwd"));

  if (limit <= 0) {
    console.log("free tier is switched off — nothing further to verify");
    return;
  }

  cleanup();

  // Spend exactly the allowance.
  const cities = Array.from({ length: limit }, (_, i) => `__verify_city_${i + 1}`);
  cities.forEach((c, i) => {
    const g = tryAnonUnlock(ID, c);
    check(`city ${i + 1} of ${limit} opens`, g.ok && g.used === i + 1, `used=${g.used}/${g.limit}`);
  });

  // One past it must be refused, and must not have consumed anything.
  const over = tryAnonUnlock(ID, "__verify_city_over");
  check("the city past the allowance is refused", !over.ok, `used=${over.used}/${over.limit}`);
  check("a refusal does not consume a slot", anonUnlockedCities(ID).length === limit);

  // Re-reading an already-open city is free and does not count again.
  const again = tryAnonUnlock(ID, cities[0]);
  check("re-opening an already-open city is free", again.ok && again.used === limit);
  check("an already-open city reads as unlocked", isAnonCityUnlocked(ID, cities[0]));
  check("a city never opened does not", !isAnonCityUnlocked(ID, "__verify_city_never"));

  // Registration carries the grants over, once.
  const moved = claimAnonUnlocks(999999999, 7, ID);
  check("registering carries every free city into the account", moved === limit, `moved=${moved}`);
  const movedAgain = claimAnonUnlocks(999999999, 7, ID);
  check("a second claim moves nothing (no double allowance)", movedAgain === 0);
  const rows = appDb().prepare("SELECT COUNT(*) n FROM city_unlocks WHERE user_id=?").get(999999999) as { n: number };
  check("the account really holds them", rows.n === limit, `rows=${rows.n}`);

  cleanup();
}

try {
  main();
} catch (e) {
  failures += 1;
  console.error("threw:", e);
} finally {
  cleanup();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
