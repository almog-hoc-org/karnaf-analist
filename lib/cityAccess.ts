/**
 * May the current request read a city's deal rows?
 *
 * The city PAGE decides this in app/city/[slug]/page.tsx (demo city, the free
 * anonymous slots, a signed-in user's unlock, the paywall kill switch). The
 * JSON routes that feed the page's drawers and map — /api/city-transactions,
 * /api/city-map/[city]/deals — answered everyone, which made the wall a
 * front door with the windows open: 1,000 rows per request, 90 per minute,
 * for any city. This is the page's rule as one function, so the routes can
 * apply exactly it.
 *
 * READ-ONLY on purpose: an API call never spends a free slot or a credit. A
 * visitor who has the page open has already been granted the city there; a
 * caller who has not is told so.
 */
import { getRuleBool, getRuleText } from "./systemRules";
import { getCurrentUser } from "./auth";
import { anonFreeCities, anonId, isAnonCityUnlocked } from "./anonAccess";
import { isCityUnlocked } from "./credits";

export type CityAccess = { ok: true } | { ok: false; status: 401 | 403; error: string };

export function cityAccess(cityName: string): CityAccess {
  if (!getRuleBool("paywall_on", true)) return { ok: true };
  if (cityName === getRuleText("demo_city", "חיפה")) return { ok: true };
  const viewer = getCurrentUser();
  if (viewer) {
    if (isCityUnlocked(viewer.id, cityName)) return { ok: true };
    return { ok: false, status: 403, error: "העיר לא פתוחה בחשבון זה — פותחים אותה מעמוד העיר" };
  }
  const aid = anonId();
  if (aid && anonFreeCities() > 0 && isAnonCityUnlocked(aid, cityName)) return { ok: true };
  return { ok: false, status: 401, error: "העסקאות של העיר זמינות אחרי כניסה לחשבון" };
}
