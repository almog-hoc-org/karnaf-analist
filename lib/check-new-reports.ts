/**
 * Report monitor — polls CBS and MoF Chief Economist for new publications.
 *
 * For each source with a monitorUrl:
 *   1. Fetch the page HTML
 *   2. Extract publication titles, links, and dates from known patterns
 *   3. Compare against data/seen_reports.json (the "seen so far" registry)
 *   4. For each NEW report:
 *        - Append to data/seen_reports.json
 *        - Append to data/reports_log.json (full event log)
 *        - Send notification via lib/notify.ts
 *
 * Run via cron:
 *   0 * * * *  cd /path/to/project && npx tsx lib/check-new-reports.ts >> /var/log/reports.log 2>&1
 *
 * Manual run:
 *   npx tsx lib/check-new-reports.ts
 */
import fs from "fs";
import path from "path";
import { SOURCES, nextExpectedPublication, type Source } from "./sources";
import { sendReportNotification, isNotifyConfigured } from "./notify";

/**
 * Base URL for links inside notification emails.
 *
 * These were hardcoded to http://localhost:3000, which is only reachable from
 * the machine that sent the mail — so every "a new report is available" link
 * was dead for its recipient. Set KARNAF_SITE_URL in the deployment.
 */
function siteUrl(): string {
  return (process.env.KARNAF_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const SEEN_FILE = path.resolve(process.cwd(), "data", "seen_reports.json");
const LOG_FILE = path.resolve(process.cwd(), "data", "reports_log.json");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 1500;

interface DetectedReport {
  title: string;
  url: string;
  publishedAt: string | null; // ISO date or null
  sourceId: string;
  detectedAt: string;
}

interface SeenRegistry {
  // Map of "${sourceId}::${url}" → first-seen ISO timestamp
  seen: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSeen(): SeenRegistry {
  if (!fs.existsSync(SEEN_FILE)) return { seen: {} };
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
  } catch {
    return { seen: {} };
  }
}

function saveSeen(reg: SeenRegistry): void {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

function appendLog(entry: DetectedReport): void {
  let log: DetectedReport[] = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    } catch {}
  }
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), "utf-8");
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`  [HTTP ${res.status}] ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(`  [FETCH ERROR] ${url}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ── Source-specific extractors ────────────────────────────────────

/**
 * Generic CBS media-release extractor.
 * CBS pages list <a> tags pointing to /he/mediarelease/... with title text.
 * Date often appears in adjacent <span> or as "תאריך פרסום: dd/mm/yyyy".
 */
function extractCbsReleases(html: string, _baseUrl: string): DetectedReport[] {
  const out: DetectedReport[] = [];
  // Match links to /he/mediarelease/Pages/YYYY/<slug>.aspx
  const linkRegex = /<a[^>]+href=["']([^"']*\/mediarelease\/Pages\/\d{4}\/[^"']+\.aspx)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seenUrls = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    let url = m[1];
    if (url.startsWith("/")) url = `https://www.cbs.gov.il${url}`;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    // Strip HTML tags from title text
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!title || title.length < 5) continue;

    // Try to extract year from URL
    const yearMatch = url.match(/\/Pages\/(\d{4})\//);
    const publishedAt = yearMatch ? `${yearMatch[1]}-01-01` : null;

    out.push({
      title,
      url,
      publishedAt,
      sourceId: "",
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Generic gov.il publications extractor for MoF Chief Economist.
 * Pattern: <a href="/he/Departments/publications/..."> with title + date.
 */
function extractMofPublications(html: string): DetectedReport[] {
  const out: DetectedReport[] = [];
  const linkRegex = /<a[^>]+href=["'](\/he\/[Dd]epartments\/publications\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seenUrls = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = `https://www.gov.il${m[1]}`;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!title || title.length < 5) continue;

    out.push({
      title,
      url,
      publishedAt: null,
      sourceId: "",
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}

function extractByDomain(url: string, html: string): DetectedReport[] {
  if (url.includes("cbs.gov.il")) return extractCbsReleases(html, url);
  if (url.includes("gov.il")) return extractMofPublications(html);
  return [];
}

// ── Main poll loop ────────────────────────────────────────────────

async function pollSource(source: Source, seen: SeenRegistry): Promise<DetectedReport[]> {
  if (!source.monitorUrl) return [];
  console.log(`\n🔍 ${source.name}`);
  console.log(`   ${source.monitorUrl}`);

  const html = await fetchPage(source.monitorUrl);
  if (!html) return [];

  const detected = extractByDomain(source.monitorUrl, html);
  console.log(`   ${detected.length} links found on page`);

  const newReports: DetectedReport[] = [];
  for (const d of detected) {
    const key = `${source.id}::${d.url}`;
    if (seen.seen[key]) continue;
    d.sourceId = source.id;
    newReports.push(d);
    seen.seen[key] = new Date().toISOString();
  }

  console.log(`   ${newReports.length} new report(s) detected`);
  return newReports;
}

async function main() {
  console.log("📡 Report monitor — checking CBS + MoF for new publications");
  console.log(`   Notifications: ${isNotifyConfigured() ? "✅ ENABLED" : "⚠️  console only (configure RESEND_API_KEY)"}`);

  const seen = loadSeen();
  const initialSeenCount = Object.keys(seen.seen).length;
  console.log(`   Already seen: ${initialSeenCount} report(s)`);

  const monitored = SOURCES.filter((s) => s.monitorUrl);
  console.log(`   Monitoring: ${monitored.length} source(s)`);

  const allNew: DetectedReport[] = [];

  for (const source of monitored) {
    try {
      const newReports = await pollSource(source, seen);
      allNew.push(...newReports);
    } catch (e) {
      console.error(`   ❌ ${source.id}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Save seen registry (only changed if new reports detected)
  if (allNew.length > 0) saveSeen(seen);

  // ── Bootstrap mode ──────────────────────────────────────────
  // First-ever run: registry was empty. Don't spam with every existing link —
  // just record them all as "seen" and notify only once with a summary.
  const isBootstrap = initialSeenCount === 0 && allNew.length > 0;
  if (isBootstrap) {
    console.log(`\n✨ Bootstrap: recorded ${allNew.length} existing reports as seen baseline.`);
    console.log(`   Future runs will only notify on NEW publications beyond this baseline.`);
    return;
  }

  if (allNew.length === 0) {
    console.log(`\n✅ No new reports via scraping.`);
    await checkOverdueReports(seen);
    return;
  }

  // ── Notify for each new report ───────────────────────────────
  console.log(`\n📢 Sending ${allNew.length} notification(s)...`);
  for (const report of allNew) {
    const source = SOURCES.find((s) => s.id === report.sourceId);
    appendLog(report);

    await sendReportNotification({
      title: report.title,
      source: source?.name || report.sourceId,
      url: report.url,
      publishedAt: report.publishedAt ?? "תאריך לא ידוע",
      summary: source?.description,
      systemUrl: `${siteUrl()}/sources/${report.sourceId}`,
    });

    await sleep(500);
  }

  console.log(`\n✅ Done.`);
}

/**
 * Schedule-based fallback: alert about sources whose next-expected publication is overdue.
 * Useful when scraping fails or the source uses a JS-rendered SPA that we can't parse.
 *
 * Uses the SEEN_FILE itself to track which overdue alerts have already fired,
 * preventing the same "overdue" alert from re-sending every cron tick.
 */
async function checkOverdueReports(seen: SeenRegistry): Promise<void> {
  const now = new Date();
  const overdueAlerts: { source: Source; expected: Date }[] = [];

  for (const source of SOURCES) {
    const next = nextExpectedPublication(source);
    if (!next) continue; // irregular/continuous schedules can't be overdue
    if (next > now) continue; // not yet due

    // Only alert once per overdue period (key includes the expected date)
    const alertKey = `OVERDUE::${source.id}::${next.toISOString().slice(0, 10)}`;
    if (seen.seen[alertKey]) continue;

    seen.seen[alertKey] = now.toISOString();
    overdueAlerts.push({ source, expected: next });
  }

  if (overdueAlerts.length === 0) {
    console.log(`✅ No overdue publications.`);
    return;
  }

  saveSeen(seen);
  console.log(`\n⏰ ${overdueAlerts.length} overdue publication(s):`);

  for (const { source, expected } of overdueAlerts) {
    const daysOverdue = Math.floor((now.getTime() - expected.getTime()) / (24 * 60 * 60 * 1000));
    console.log(`   ${source.name} — ${daysOverdue} days overdue (expected ${expected.toISOString().slice(0, 10)})`);

    await sendReportNotification({
      title: `${source.name} — פרסום מתעכב (${daysOverdue} ימים)`,
      source: source.organization,
      url: source.monitorUrl || source.url,
      publishedAt: `צפוי היה ${expected.toLocaleDateString("he-IL")}`,
      summary: `המקור הזה אמור היה לפרסם דוח ב-${expected.toLocaleDateString("he-IL")} ועדיין לא זוהה פרסום חדש. כדאי לבדוק ידנית.`,
      systemUrl: `${siteUrl()}/sources/${source.id}`,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
