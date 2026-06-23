/**
 * Data refresh orchestrator.
 *
 * Triggered by POST /api/refresh-data. Goal: find new CBS publications since
 * the last refresh, download them, parse them, and update both:
 *   • data/recent_reports.json  (drives the homepage section)
 *   • data/seen_reports.json    (dedup registry)
 *
 * Strategy (keeps each refresh under ~30 seconds):
 *   1. Compute the "search window" — the last 6 months of publication numbers
 *      for each subject (prices, construction, transactions).
 *   2. Skip anything already in seen_reports.json.
 *   3. Try-download each candidate (small pauses to be polite).
 *   4. For each NEW PDF: extract text, identify the report type, save under
 *      /public/reports/ + /data/reports/recent/.
 *   5. Append to recent_reports.json + seen_reports.json.
 *
 * For now we DON'T also walk the DB tables. That's a follow-up: extracted
 * numbers feed back into national_construction etc. via existing import
 * scripts.
 */
import fs from "fs";
import path from "path";
import {
  discoverCbsReports,
  extractPdfText,
  type SubjectKey,
} from "./cbs-fetcher";

export interface RefreshEvent {
  type: "log" | "skip" | "tried" | "found" | "miss" | "parsed" | "saved" | "error" | "summary" | "done";
  message: string;
  data?: Record<string, unknown>;
}

export interface RefreshSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempted: number;
  found: number;
  skipped: number;
  errors: number;
  newReports: Array<{
    publicationNumber: string;
    subject: string;
    title: string;
    pdfUrl: string;
    localPath: string;
  }>;
}

const SEEN_FILE = path.resolve(process.cwd(), "data", "seen_reports.json");
const RECENT_FILE = path.resolve(process.cwd(), "data", "recent_reports.json");

interface SeenRegistry {
  seen: Record<string, string>;
  /** Tuple-keyed registry: "{subject}:{year}:{num}" → ISO timestamp */
  publications?: Record<string, string>;
}

function loadSeen(): SeenRegistry {
  if (!fs.existsSync(SEEN_FILE)) return { seen: {}, publications: {} };
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
    if (!data.publications) data.publications = {};
    return data;
  } catch {
    return { seen: {}, publications: {} };
  }
}

function saveSeen(reg: SeenRegistry) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

interface RecentReportEntry {
  id: string;
  title: string;
  publicationNumber: string;
  subject: SubjectKey;
  year: number;
  publisher: "CBS";
  publishedDate: string | null;
  pdfUrl: string;
  primaryPdfPath: string;
  discoveredAt: string;
  /** First 800 chars of extracted text — useful for downstream titling */
  preview: string;
}

interface RecentReportsFile {
  reports: RecentReportEntry[];
  lastRefreshedAt: string;
}

function loadRecent(): RecentReportsFile {
  if (!fs.existsSync(RECENT_FILE)) return { reports: [], lastRefreshedAt: "" };
  try {
    return JSON.parse(fs.readFileSync(RECENT_FILE, "utf-8"));
  } catch {
    return { reports: [], lastRefreshedAt: "" };
  }
}

function saveRecent(data: RecentReportsFile) {
  fs.mkdirSync(path.dirname(RECENT_FILE), { recursive: true });
  fs.writeFileSync(RECENT_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Heuristic: extract a clean title from the PDF text. CBS reports follow a
 * very stable pattern:
 *
 *   <metadata>          — אתר/דוא"ל/פקס/כתבה/לקבלת/מדינת/הודעה/ירושלים lines
 *   <Hebrew date>       — "12 בפברואר, 2026" or "א' בניסן תשפ"ו, 19 במרץ 2026"
 *   <pub_number>        — "047/2026"
 *   <Hebrew title>      — the actual subject of the report (this is what we want)
 *   <English title>     — translation of the Hebrew title
 *
 * The Hebrew title is the FIRST non-metadata Hebrew line that comes after the
 * publication number pattern.
 */
const METADATA_PREFIXES = [
  "אתר", "דוא", "פקס", "כתבה", "לקבלת", "מדינת", "הודעה", "ירושלים",
  "להרחבה", "פרסום", "להסברים", "או באמצעות", "טופס", "לסטטיסטיקאי",
  "תשפ", "תשפ\"", "כתבו", "תקשור", "תאריך",
];

function isMetadataLine(line: string): boolean {
  // Lines with only/mostly underscores, equals signs, or numbers (dates, etc.)
  if (/^[_=\-\s.0-9:/]+$/.test(line)) return true;
  for (const p of METADATA_PREFIXES) {
    if (line.startsWith(p)) return true;
    if (line.startsWith(":" + p)) return true; // ":אתר www.cbs.gov.il"
  }
  // Lines with email/URL artifacts
  if (line.includes("@") || line.includes("www.") || line.includes("://")) return true;
  // Pure numeric or short
  if (line.length < 14) return true;
  // Just date or publication number lines
  if (/^\d{3}\/\d{4}$/.test(line)) return true;
  return false;
}

/**
 * Real-estate relevance check.
 *
 * CBS publication subject codes are coarse — "10" covers ALL CBS price indexes
 * including CPI and industrial output prices, not just housing. We require the
 * report's first ~2000 chars to mention one of these housing keywords.
 */
const REAL_ESTATE_KEYWORDS = [
  "דירות", "דיור", 'נדל"ן', "נדלן", "התחלות בנייה", "היתרי בנייה",
  "שוק הדירות", "סיומי בנייה", "גמר בנייה", "שכר דירה", "התחדשות עירונית",
  "עסקאות נדל", "מחירי הדירות",
];

function isRealEstateReport(text: string): boolean {
  const sample = text.slice(0, 2500);
  return REAL_ESTATE_KEYWORDS.some((kw) => sample.includes(kw));
}

function extractTitleAndDate(text: string): { title: string; publishedDate: string | null } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Date: handle 2 formats. CBS PDFs often break lines mid-word, so we look at
  // the joined text with whitespace collapsed.
  //   • "15 בפברואר, 2026"  (clean)
  //   • "15 פברו אר 2026" or "15\nב\nפברואר\n,\n2026" (text-extraction artifacts)
  const HE_MONTHS: Record<string, number> = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
  };
  let publishedDate: string | null = null;
  // Collapse whitespace + drop the "ב" prefix on months to absorb both forms
  const flat = lines.slice(0, 50).join(" ").replace(/\s+/g, " ");
  // Match "<day> ב?<month> <year>" allowing optional commas and spaces
  for (const [monthName, monthNum] of Object.entries(HE_MONTHS)) {
    const re = new RegExp(`(\\d{1,2})\\s*ב?\\s*${monthName}\\s*,?\\s*(\\d{4})`);
    const m = flat.match(re);
    if (m) {
      const day = parseInt(m[1], 10);
      const year = parseInt(m[2], 10);
      if (day >= 1 && day <= 31 && year >= 2020) {
        publishedDate = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        break;
      }
    }
  }

  // Title: find the publication number line, then the next non-metadata
  // Hebrew line is the title.
  let title = "";
  let foundPubLine = false;
  for (const line of lines.slice(0, 60)) {
    if (/^\d{3}\/\d{4}$/.test(line)) {
      foundPubLine = true;
      continue;
    }
    if (!foundPubLine) continue;
    if (isMetadataLine(line)) continue;
    // Stop on English (which comes after the Hebrew title)
    if (/^[A-Za-z]/.test(line)) break;
    // Require Hebrew characters
    if (/[֐-׿]/.test(line)) {
      title = line.replace(/\s+/g, " ").trim();
      break;
    }
  }

  // Fallback: scan the whole document for the longest meaningful Hebrew line in the first 40
  if (!title) {
    for (const line of lines.slice(0, 40)) {
      if (isMetadataLine(line)) continue;
      if (/[֐-׿]/.test(line) && line.length > 20) {
        title = line.replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  return { title: title || "(טרם זוהה)", publishedDate };
}

/**
 * Map a subject key to the list of publication numbers we should probe.
 *
 * We pick a window centered around what's already in seen_reports. If nothing
 * is seen yet, we probe a sane default range for 2026.
 *
 * To keep the refresh quick, we probe AT MOST `probeBudget` candidates per
 * subject.
 */
function buildProbeList(known: Set<string>, year: number, subject: SubjectKey, probeBudget = 25): string[] {
  // Find the highest publication number already known for this subject
  let maxKnown = 0;
  for (const id of known) {
    const [s, y, num] = id.split(":");
    if (s === subject && parseInt(y, 10) === year) {
      const n = parseInt(num, 10);
      if (n > maxKnown) maxKnown = n;
    }
  }
  // Probe from maxKnown+1 up to maxKnown + budget
  // If nothing known, start from 040 (CBS press releases typically start ~040 in early Feb)
  const start = maxKnown > 0 ? maxKnown + 1 : 40;
  const end = start + probeBudget;
  const list: string[] = [];
  for (let n = start; n < end; n++) {
    list.push(String(n).padStart(3, "0"));
  }
  return list;
}

/**
 * Generator-based refresh — yields events for streaming progress to the client.
 */
export async function* refreshDataStream(opts?: {
  year?: number;
  probeBudget?: number;
}): AsyncGenerator<RefreshEvent, RefreshSummary, unknown> {
  const startedAt = new Date();
  const year = opts?.year ?? new Date().getFullYear();
  const probeBudget = opts?.probeBudget ?? 20;

  const seen = loadSeen();
  const recent = loadRecent();

  // Seed the "publications" registry from already-known reports
  const knownIds = new Set<string>();
  for (const id of Object.keys(seen.publications ?? {})) knownIds.add(id);
  for (const r of recent.reports) knownIds.add(`${r.subject}:${r.year}:${r.publicationNumber}`);

  yield {
    type: "log",
    message: `🔍 בודק דוחות חדשים — ${knownIds.size} דוחות כבר במערכת. מחפש ב-3 קטגוריות.`,
    data: { knownCount: knownIds.size, year, probeBudget },
  };

  // Only probe subject codes that produce real-estate reports.
  // Subject "01" (population) rarely yields nadlan-specific content — the
  // relevance filter would just drop them all, so we skip the lookup work.
  const subjects: SubjectKey[] = ["prices", "construction"];
  let attempted = 0;
  let found = 0;
  let skipped = 0;
  let errors = 0;
  const newReports: RefreshSummary["newReports"] = [];

  for (const subject of subjects) {
    const numbers = buildProbeList(knownIds, year, subject, probeBudget);
    yield {
      type: "log",
      message: `📋 ${subjectHebrew(subject)} — בודק ${numbers.length} מספרי פרסום (${numbers[0]}-${numbers[numbers.length - 1]})`,
      data: { subject, count: numbers.length },
    };

    const discovered = await discoverCbsReports({
      year,
      subject,
      numbers,
      knownIds,
      onProgress: () => {
        // Could yield mid-discovery, but simpler to batch
      },
    });
    attempted += numbers.length;

    for (const d of discovered) {
      try {
        const text = await extractPdfText(d.localPath!);
        // Filter: only keep real-estate-relevant reports
        if (!isRealEstateReport(text)) {
          // Delete the PDF — it's not real estate, no reason to keep it
          try { fs.unlinkSync(d.localPath!); } catch {}
          try { fs.unlinkSync(path.join(process.cwd(), "public", "reports", path.basename(d.localPath!))); } catch {}
          // Still mark as seen so we don't re-check it next time
          seen.publications![`${d.subject}:${d.year}:${d.publicationNumber}`] = new Date().toISOString();
          knownIds.add(`${d.subject}:${d.year}:${d.publicationNumber}`);
          yield {
            type: "skip",
            message: `⊘ ${d.publicationNumber}/${d.year} — לא בתחום הנדל"ן (סונן ונרשם כידוע)`,
          };
          continue;
        }
        const { title, publishedDate } = extractTitleAndDate(text);
        const id = `${d.subject}:${d.year}:${d.publicationNumber}`;
        const pdfFilename = path.basename(d.localPath!);
        const entry: RecentReportEntry = {
          id,
          title,
          publicationNumber: d.publicationNumber,
          subject: d.subject,
          year: d.year,
          publisher: "CBS",
          publishedDate,
          pdfUrl: d.url,
          primaryPdfPath: `/reports/${pdfFilename}`,
          discoveredAt: new Date().toISOString(),
          preview: text.slice(0, 800),
        };
        recent.reports.unshift(entry);
        seen.publications![id] = new Date().toISOString();
        knownIds.add(id);
        newReports.push({
          publicationNumber: d.publicationNumber,
          subject: d.subject,
          title,
          pdfUrl: d.url,
          localPath: entry.primaryPdfPath,
        });
        found++;
        yield {
          type: "found",
          message: `✓ ${subjectHebrew(d.subject)} ${d.publicationNumber}/${d.year} — ${title}`,
          data: { id, title, publishedDate, pdfUrl: d.url },
        };
      } catch (err) {
        errors++;
        yield {
          type: "error",
          message: `✗ שגיאה ב-${d.publicationNumber}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    skipped += numbers.length - discovered.length;
  }

  // Persist
  recent.lastRefreshedAt = new Date().toISOString();
  // Cap at 50 most recent
  recent.reports = recent.reports.slice(0, 50);
  saveRecent(recent);
  saveSeen(seen);

  const finishedAt = new Date();
  const summary: RefreshSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempted,
    found,
    skipped,
    errors,
    newReports,
  };
  yield {
    type: "summary",
    message: found > 0
      ? `🎉 הסתיים. נמצאו ${found} דוחות חדשים, ${skipped} כבר היו במערכת, ${errors} שגיאות. משך: ${Math.round(summary.durationMs / 1000)} שנ׳.`
      : `✓ הסתיים. אין דוחות חדשים מאז העדכון האחרון (בדקנו ${attempted}). משך: ${Math.round(summary.durationMs / 1000)} שנ׳.`,
    data: summary as unknown as Record<string, unknown>,
  };
  yield { type: "done", message: "done" };
  return summary;
}

function subjectHebrew(s: SubjectKey): string {
  if (s === "prices") return 'מחירי דירות (מדד)';
  if (s === "construction") return 'התחלות וגמר בנייה';
  return "אוכלוסייה";
}
