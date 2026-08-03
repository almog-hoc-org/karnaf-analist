/**
 * The COLLECTION layer: what brings new data in.
 *
 * WHY THIS FILE EXISTS
 * lib/pipeline.ts defines eleven stages that clean, classify, aggregate and
 * verify. Not one of them fetches anything. The nightly timer therefore
 * re-derived the same static snapshot every night — correctly, thoroughly, and
 * pointlessly. A deal published tomorrow by the tax authority would never have
 * entered the database.
 *
 * The collection that used to happen lived on one person's Mac, in two shell
 * scripts (biweekly-refresh.sh, monthly-refresh.sh) plus manual runs of the
 * transaction collectors. None of it moved to the server. This file is that
 * work, expressed as data instead of prose, so a scheduled run can execute it.
 *
 * HOW THIS DIFFERS FROM THE CLEANING PIPELINE — AND WHY
 * The cleaning pipeline is a CHAIN: stage N assumes stage N-1 finished, so the
 * first failure has to stop everything. Collection is a FAN: govmap being down
 * has nothing to do with whether CBS published a new report. Treating it as a
 * chain would mean one unreachable government website silently costing us every
 * other source that night. So each source here is isolated — it fails alone, it
 * is recorded alone, and the run continues.
 *
 * REACHABILITY IS MEASURED, NOT ASSUMED
 * This server sits in Europe and every source is an Israeli government host.
 * Whether they answer from here is a fact about the network, not something to
 * be decided in advance — so each run probes the hosts first and says plainly
 * what answered. That turns "is govmap blocked from the VPS?" from a question
 * somebody has to remember to ask into a line in the log of every run.
 */

export interface CollectorSource {
  /** Stable id — used by --only, --skip and the run log. Never rename casually. */
  id: string;
  /** Command to run. python3 for the CBS completions importer, npx tsx otherwise. */
  cmd: string;
  args: string[];
  /** Hebrew label for the log and the admin UI. */
  label: string;
  /** What this actually brings in, and why it is worth the request budget. */
  why: string;
  /** Host to probe before running. null = reads local files only, nothing to probe. */
  host: string | null;
  /**
   * A REAL request against the endpoint the collector actually uses.
   *
   * ⚠️ WHY A PLAIN HOST PROBE IS NOT ENOUGH — this cost a full collection run.
   * The first version fetched the API base URL and treated any answer as
   * success. govmap returned HTTP 200 for it, the probe went green, and then
   * every single one of 168 cities failed with "Unexpected token '<'" — the
   * endpoint was serving an HTML page where the collector expected JSON. The
   * probe had confirmed that a web server was listening, which is not the
   * question anyone was asking.
   *
   * So a probe now sends the request the collector sends and checks the answer
   * parses as what the collector will try to parse. A green probe means the
   * source is usable, not merely present.
   */
  probe?: {
    url: string;
    method?: "GET" | "POST";
    body?: unknown;
    /** Fail the probe unless the response body parses as JSON. */
    expectJson?: boolean;
  };
  /**
   * Needs a real Chrome that has passed reCAPTCHA (KARNAF_CHROME_URL).
   * Skipped — loudly, never silently — when that is not configured.
   */
  requiresBrowser?: boolean;
  timeoutMs: number;
}

const MINUTE = 60_000;

export const SOURCES: CollectorSource[] = [
  {
    id: "govmap",
    cmd: "npx",
    args: ["tsx", "scripts/collect-govmap-transactions.ts"],
    label: "עסקאות govmap (רשות המסים)",
    why: "The broad multi-year transaction feed — every deal 2016→now, all cities, no browser needed. This is the source that actually keeps the price series current. It skips cities collected within KARNAF_GOVMAP_FRESH_DAYS (default 20), so a nightly run touches a slice of the country rather than all of it. Operating this by hand meant running it daily because deals go missing and a re-run finds them, which argues for a shorter window than the backfill default once we have real timings.",
    host: "https://www.govmap.gov.il/api",
    // The collector's very first call for every city. If this is not JSON,
    // nothing downstream can work — which is exactly what happened.
    probe: {
      url: "https://www.govmap.gov.il/api/search-service/autocomplete",
      method: "POST",
      body: { searchText: "חיפה", language: "he", isAccurate: false, maxResults: 10 },
      expectJson: true,
    },
    timeoutMs: 90 * MINUTE,
  },
  {
    id: "nadlan",
    cmd: "npx",
    args: ["tsx", "scripts/collect-nadlan-transactions.ts"],
    label: "עסקאות nadlan (עם שנת בנייה)",
    why: "The ONLY source of year_built and hok_hamecher — the two fields the sale-channel classifier needs. Their absence is exactly why 95,485 deals sit unclassified and outside the 'all' price series. Needs a real browser: the site gates on reCAPTCHA, and the collector reuses the token the page legitimately produced rather than minting one.",
    host: "https://www.nadlan.gov.il",
    requiresBrowser: true,
    timeoutMs: 120 * MINUTE,
  },
  {
    id: "cbs-reports",
    cmd: "npx",
    args: ["tsx", "lib/check-new-reports.ts"],
    label: "פרסומים חדשים — למ״ס ואגף הכלכלן הראשי",
    why: "Polls the publication pages and records anything new against data/seen_reports.json. Cheap, and it is what makes a new CBS release visible the day it appears instead of whenever someone happens to look.",
    host: "https://www.cbs.gov.il",
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "cbs-extract",
    cmd: "npx",
    args: ["tsx", "scripts/run-refresh.ts"],
    label: "הורדה וחילוץ מפרסומי הלמ״ס והאוצר",
    why: "The step that turns a detected publication into NUMBERS. cbs-reports above only notices that something was published and says so; this one pulls the Chief Economist listing API, walks the CBS rolling publication window, downloads the PDFs, runs pdfplumber over them and writes provenance-tagged city facts. Without it the thirteen CBS and MoF sources are monitored and never read — which was the state until now, and is indistinguishable from them having nothing to say.",
    host: "https://www.gov.il",
    timeoutMs: 45 * MINUTE,
  },
  {
    id: "national-completions",
    cmd: "python3",
    args: ["scripts/import_national_completions.py"],
    label: "גמרי בנייה ארציים (למ״ס)",
    why: "The national construction-completion series behind the supply pages. A separate importer because the source is a spreadsheet the CBS publishes, parsed in python.",
    host: "https://www.cbs.gov.il",
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "import-updates",
    cmd: "npx",
    args: ["tsx", "lib/import-updates.ts"],
    label: "ייבוא עדכוני נתונים מקומיים",
    why: "Loads whatever landed in data/*.json into the database. Reads no network — it is the step that makes a file dropped by any other process actually take effect, and it is idempotent, so running it on a night when nothing arrived costs a few seconds.",
    host: null,
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "import-yad2",
    cmd: "npx",
    args: ["tsx", "lib/import-yad2.ts"],
    label: "ייבוא נתוני יד2",
    why: "Imports data/yad2_scrape.json into yad2_market_data. The scrape itself needs a browser and is not automated here yet, so on most nights this is a no-op that simply refreshes nothing — which is the honest behaviour, rather than reporting success for data that did not arrive.",
    host: null,
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "prefetch-deals",
    cmd: "npx",
    args: ["tsx", "lib/prefetch-deals.ts"],
    label: "חימום מטמון העסקאות",
    why: "Writes per-city deal JSON under data/deals_cache so the live UI never waits on govmap. Runs last: it caches what the collectors just brought in, so doing it first would cache the previous night's picture.",
    host: "https://www.govmap.gov.il/api",
    probe: {
      url: "https://www.govmap.gov.il/api/search-service/autocomplete",
      method: "POST",
      body: { searchText: "חיפה", language: "he", isAccurate: false, maxResults: 10 },
      expectJson: true,
    },
    timeoutMs: 60 * MINUTE,
  },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);

/**
 * One probe per distinct target. Sources that declare a real request get that
 * request; the rest fall back to their host, which only ever proves a server is
 * listening — see the warning on `probe`.
 */
export interface ProbeTarget {
  key: string;
  label: string;
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  expectJson: boolean;
  /** Sources that depend on this target. */
  sources: string[];
}

export function probeTargets(sources: CollectorSource[] = SOURCES): ProbeTarget[] {
  const byKey = new Map<string, ProbeTarget>();
  for (const s of sources) {
    const p = s.probe;
    const url = p?.url ?? s.host;
    if (!url) continue;
    const key = url + (p?.method ?? "GET");
    const existing = byKey.get(key);
    if (existing) { existing.sources.push(s.id); continue; }
    byKey.set(key, {
      key,
      label: p ? `${new URL(url).host}${new URL(url).pathname}` : new URL(url).host,
      url,
      method: p?.method ?? "GET",
      body: p?.body,
      expectJson: p?.expectJson ?? false,
      sources: [s.id],
    });
  }
  return [...byKey.values()];
}

/** The probe key a source depends on, or null when it needs no network. */
export function probeKeyFor(s: CollectorSource): string | null {
  const url = s.probe?.url ?? s.host;
  if (!url) return null;
  return url + (s.probe?.method ?? "GET");
}

/**
 * Select sources by id, preserving the declared order.
 * Throws on an unknown id rather than silently collecting nothing.
 */
export function selectSources(only?: string[], skip?: string[]): CollectorSource[] {
  const known = new Set(SOURCE_IDS);
  for (const id of [...(only ?? []), ...(skip ?? [])]) {
    if (!known.has(id)) throw new Error(`unknown source "${id}". known: ${SOURCE_IDS.join(", ")}`);
  }
  return SOURCES.filter(
    (s) => (!only?.length || only.includes(s.id)) && !(skip ?? []).includes(s.id)
  );
}
