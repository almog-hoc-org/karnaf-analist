/**
 * A city name as a person typed it → the name the database holds, or null.
 *
 * The city page looked the slug up by exact string, so "/city/תל אביב",
 * "/city/קרית גת" and "/city/פתח תקוה" each rendered a "city not found"
 * screen (with HTTP 200 and a full title, which search engines indexed).
 * Resolution here is in three steps, cheapest first: the explicit alias
 * table, the exact name, then the spelling folder in lib/cityAliases over
 * the (cached) list of every city we have.
 */
import { prisma } from "./db";
import { cachedSet, TAGS, TTL } from "./cache";
import { canonicalCityName, normalizeCity } from "./cityAliases";

const loadCityNames = cachedSet(
  async () => new Set((await prisma.city.findMany({ select: { city_name: true } })).map((c) => c.city_name)),
  ["city-names"],
  TAGS.reference,
  TTL.reference,
  true,
);

/** Pure: the one known name whose folded spelling equals the input's, else null. */
export function matchCityName(name: string, known: Iterable<string>): string | null {
  const want = normalizeCity(canonicalCityName(name));
  if (!want) return null;
  for (const k of known) if (k === name) return k;
  for (const k of known) if (normalizeCity(k) === want) return k;
  return null;
}

export async function resolveCityName(raw: string): Promise<string | null> {
  const name = canonicalCityName(raw.trim());
  if (!name) return null;
  return matchCityName(name, await loadCityNames());
}
