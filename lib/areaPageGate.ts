import { redirect } from "next/navigation";
import { getCurrentUser } from "./auth";
import { getRuleBool, getRuleText } from "./systemRules";
import { isCityUnlocked } from "./credits";
import { anonId, isAnonCityUnlocked } from "./anonAccess";

/**
 * The access gate the neighbourhood, street and address pages share.
 *
 * Open to everyone while the page family's rule says so (the operator's
 * decision, 8/2026 — these pages are the long tail a search engine sends
 * people to). When the rule is switched off the page requires exactly what
 * its parent city requires, and a walled visitor is REDIRECTED to the city
 * page rather than shown a second copy of the wall: one gate, maintained
 * once. Deliberately no anonymous free-slot spending here in either mode —
 * a visitor landing on a street from a search result must not burn a free
 * CITY slot on it.
 */
export function gateAreaPage(cityName: string, publicRule: "neighborhood_pages_public" | "street_pages_public"): void {
  if (getRuleBool(publicRule, true)) return;
  const paywallOn = getRuleBool("paywall_on", true);
  const demoCity = getRuleText("demo_city", "חיפה");
  if (!paywallOn || cityName === demoCity) return;
  const viewer = getCurrentUser();
  const aid = viewer ? null : anonId();
  const anonHasCity = !!aid && isAnonCityUnlocked(aid, cityName);
  if (!anonHasCity && (!viewer || !isCityUnlocked(viewer.id, cityName))) {
    redirect(`/city/${encodeURIComponent(cityName)}`);
  }
}
