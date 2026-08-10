/**
 * Disk-based cache for city deals data.
 * Stores per-city JSON files under data/deals_cache/.
 * Cache is permanent until refreshed via the pre-fetch script.
 */
import fs from "fs";
import path from "path";
import type { CityDealsData } from "./govNadlanService";

const CACHE_DIR = path.resolve(process.cwd(), "data", "deals_cache");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function safeFileName(cityName: string): string {
  // Replace path-unsafe characters; keep Hebrew letters
  return cityName.replace(/[/\\?%*:|"<>]/g, "_") + ".json";
}

export function getCachedDeals(cityName: string): CityDealsData | null {
  try {
    const file = path.join(CACHE_DIR, safeFileName(cityName));
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw) as CityDealsData;
  } catch {
    return null;
  }
}

export function setCachedDeals(cityName: string, data: CityDealsData): void {
  ensureDir();
  const file = path.join(CACHE_DIR, safeFileName(cityName));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

export function listCachedCities(): string[] {
  ensureDir();
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/**
 * Aggregate freshness of the whole cache directory, for /api/status and the
 * admin panel: how many cities have a cache file, and how old the newest one
 * is. Uses the LATEST mtime — the question is "when did a refresh last land",
 * not "which single city is oldest".
 */
export function cacheStats(): { files: number; newestAt: string | null } {
  try {
    if (!fs.existsSync(CACHE_DIR)) return { files: 0, newestAt: null };
    let files = 0;
    let newest = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith(".json")) continue;
      files++;
      const m = fs.statSync(path.join(CACHE_DIR, f)).mtimeMs;
      if (m > newest) newest = m;
    }
    return { files, newestAt: newest ? new Date(newest).toISOString() : null };
  } catch {
    return { files: 0, newestAt: null };
  }
}

export function cacheAge(cityName: string): number | null {
  try {
    const file = path.join(CACHE_DIR, safeFileName(cityName));
    if (!fs.existsSync(file)) return null;
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
