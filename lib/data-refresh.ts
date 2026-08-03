/**
 * Data refresh orchestrator — CBS + Ministry of Finance (rewritten 2026-07-30).
 *
 * Every button click scans BOTH sources for ALL publications the system has
 * not ingested yet (user directive), filters them by TITLE against the
 * real-estate lexicon, extracts text + tables, auto-integrates numbers into
 * the site's landing zones (full-automatic mode — the user's explicit choice),
 * and updates data/recent_reports.json which the homepage reads.
 *
 * The three root causes of "הרענון לא מוצא כלום" and their fixes:
 *   1. FROZEN WINDOW — misses were never recorded, so the probe window never
 *      advanced past February. Fix: data/refresh_probe_state.json records
 *      every probed number; CBS numbers are GLOBALLY sequential across all
 *      subjects, so once a HIGHER number is found anywhere, lower missing
 *      numbers are closed forever and the window rolls forward.
 *   2. BODY-TEXT FILTER — matched "דיור" inside the CPI release. Fix: filter
 *      on the extracted TITLE with the full lexicon (incl. גרשיים variants).
 *   3. FINDS NEVER SHOWN — recent_reports.json was written but nothing read
 *      it. Fix: the homepage section now receives these entries (loadDiscoveredReports).
 *
 * MoF discovery uses the unchallenged openapi-gc.digital.gov.il API
 * (lib/govil-fetcher.ts) — the old www.gov.il scraper hit Cloudflare and the
 * OfficeId GUID it used was wrong (returned 0 results even in a browser).
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  buildCbsPdfUrl,
  discoverCbsReports,
  extractPdfText,
  type SubjectKey,
} from "./cbs-fetcher";
import { fetchMofPublications, fetchGovilPageContent } from "./govil-fetcher";

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
const PROBE_FILE = path.resolve(process.cwd(), "data", "refresh_probe_state.json");
const FACTS_FILE = path.resolve(process.cwd(), "data", "scattered_city_facts.json");
const EXTRACT_DIR = path.resolve(process.cwd(), "data", "reports", "extracted");

/* ── TITLE lexicon (user's list, incl. Hebrew-punctuation variants) ─────── */
export const TITLE_LEXICON = [
  "דירה", "דירות", "מגורים", 'נדל"ן', "נדל״ן", "נדלן", "דיור",
  "בנייה", "בניה", "היתרי בנייה", "היתרי בניה", "התחלות בנייה", "התחלות בניה",
  "גמר בנייה", "גמר בניה", "שכר דירה", "שכירות", "משכנתא", "משכנתאות",
  "התחדשות עירונית", "מקרקעין", "שוק הדיור", "מחירי הדיור",
];

export function titleIsRealEstate(title: string): boolean {
  const t = title.replace(/[״"']/g, '"'); // normalize gershayim so נדל"ן ≡ נדל״ן
  return TITLE_LEXICON.some((kw) => t.includes(kw.replace(/[״"']/g, '"')));
}

/* ── registries ─────────────────────────────────────────────────────────── */
interface SeenRegistry {
  seen: Record<string, string>;
  /** "{subject}:{year}:{num}" or "mof:{slug}" → ISO timestamp */
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

/** CBS probe state — what makes the window ADVANCE between refreshes. */
interface ProbeState {
  year: number;
  /** highest publication number FOUND per subject (its series frontier) */
  maxFound: Record<string, number>;
  /** number (global sequence) → consecutive miss count, per subject */
  misses: Record<string, Record<string, number>>;
  /** numbers permanently closed per subject (belong to other CBS series) */
  closed: Record<string, string[]>;
}
function loadProbeState(year: number): ProbeState {
  try {
    const s = JSON.parse(fs.readFileSync(PROBE_FILE, "utf-8")) as Partial<ProbeState>;
    if (s.year === year) {
      return { year, maxFound: s.maxFound ?? {}, misses: s.misses ?? {}, closed: s.closed ?? {} };
    }
  } catch { /* first run / new year */ }
  return { year, maxFound: {}, misses: {}, closed: {} };
}
function saveProbeState(s: ProbeState) {
  fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
  fs.writeFileSync(PROBE_FILE, JSON.stringify(s, null, 2), "utf-8");
}

/* ── recent-reports store (read by the homepage) ────────────────────────── */
export interface RecentReportEntry {
  id: string;
  title: string;
  publicationNumber: string;
  subject: SubjectKey | "mof";
  year: number;
  publisher: "CBS" | "MoF";
  publishedDate: string | null;
  /** original document / page URL at the source */
  pdfUrl: string;
  /** local copy served from /public (CBS only — MoF blobs are CF-gated) */
  primaryPdfPath: string | null;
  discoveredAt: string;
  preview: string;
  /** short extracted headline numbers (MoF reviews) */
  highlights?: string[];
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

/** Server-side loader for UI components (homepage reports section). */
export function loadDiscoveredReports(limit = 12): { reports: RecentReportEntry[]; lastRefreshedAt: string } {
  const r = loadRecent();
  // real-estate titles only (early files may hold pre-filter finds like the CPI),
  // newest publication first regardless of the order discovery inserted them
  const reports = r.reports
    .filter((x) => titleIsRealEstate(x.title))
    .sort((a, b) => (b.publishedDate ?? "").localeCompare(a.publishedDate ?? ""))
    .slice(0, limit);
  return { reports, lastRefreshedAt: r.lastRefreshedAt };
}

/* ── CBS title/date extraction (kept from the previous engine — works) ──── */
const METADATA_PREFIXES = [
  "אתר", "דוא", "פקס", "כתבה", "לקבלת", "מדינת", "הודעה", "ירושלים",
  "להרחבה", "פרסום", "להסברים", "או באמצעות", "טופס", "לסטטיסטיקאי",
  "תשפ", 'תשפ"', "כתבו", "תקשור", "תאריך",
];

function isMetadataLine(line: string): boolean {
  if (/^[_=\-\s.0-9:/]+$/.test(line)) return true;
  for (const p of METADATA_PREFIXES) {
    if (line.startsWith(p)) return true;
    if (line.startsWith(":" + p)) return true;
  }
  if (line.includes("@") || line.includes("www.") || line.includes("://")) return true;
  if (line.length < 14) return true;
  if (/^\d{3}\/\d{4}$/.test(line)) return true;
  return false;
}

function extractTitleAndDate(text: string): { title: string; publishedDate: string | null } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const HE_MONTHS: Record<string, number> = {
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
  };
  let publishedDate: string | null = null;
  const flat = lines.slice(0, 50).join(" ").replace(/\s+/g, " ");
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
  let title = "";
  let foundPubLine = false;
  for (const line of lines.slice(0, 60)) {
    if (/^\d{3}\/\d{4}$/.test(line)) { foundPubLine = true; continue; }
    if (!foundPubLine) continue;
    if (isMetadataLine(line)) continue;
    if (/^[A-Za-z]/.test(line)) break;
    if (/[֐-׿]/.test(line)) { title = line.replace(/\s+/g, " ").trim(); break; }
  }
  if (!title) {
    for (const line of lines.slice(0, 40)) {
      if (isMetadataLine(line)) continue;
      if (/[֐-׿]/.test(line) && line.length > 20) { title = line.replace(/\s+/g, " ").trim(); break; }
    }
  }
  return { title: title || "(טרם זוהה)", publishedDate };
}

/* ── pdfplumber table extraction ────────────────────────────────────────── */
/**
 * Extract tables from a PDF via pdfplumber.
 *
 * ⚠️ THE FAILURE MODE THIS GUARDS AGAINST
 * Every error path here used to resolve to an empty array, which made two
 * completely different situations look identical: "this PDF contains no
 * tables" and "pdfplumber is not installed on this machine". The second was
 * true on the server for as long as it had been running — the image shipped
 * python3 with no packages — so document extraction reported a calm, steady
 * nothing, and looked exactly like the CBS having published nothing worth
 * parsing.
 *
 * An empty result is still returned rather than thrown, because one unparsable
 * PDF must not abort a refresh that is also fetching other things. But a
 * MISSING DEPENDENCY is not a property of the document, it is a broken machine,
 * and it now says so loudly instead of masquerading as an empty table set.
 */
async function extractPdfTables(pdfPath: string): Promise<Array<{ page: number; rows: string[][] }>> {
  return new Promise((resolve) => {
    const py = spawn("python3", [
      "-c",
      `import pdfplumber, json, sys
out=[]
with pdfplumber.open(sys.argv[1]) as pdf:
    for pi, page in enumerate(pdf.pages):
        for t in (page.extract_tables() or []):
            rows=[[(c or '').strip() for c in row] for row in t if row]
            if rows: out.append({'page': pi+1, 'rows': rows})
print(json.dumps(out, ensure_ascii=False))`,
      pdfPath,
    ]);
    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));
    py.on("close", (code) => {
      if (code !== 0) {
        // ModuleNotFoundError / ImportError means the toolchain is missing, not
        // that the document was empty. Never let those two look the same.
        if (/ModuleNotFoundError|ImportError/.test(stderr)) {
          console.error(
            "✗ pdfplumber חסר — חילוץ טבלאות מ-PDF מושבת לחלוטין.\n" +
            "  התקן:  pip3 install --break-system-packages -r requirements.txt\n" +
            `  ${stderr.trim().split("\n").pop()}`
          );
        } else {
          console.error(`✗ חילוץ טבלאות נכשל (${pdfPath}): ${stderr.trim().slice(-200)}`);
        }
        return resolve([]);
      }
      try { resolve(JSON.parse(stdout)); }
      catch { console.error(`✗ פלט pdfplumber אינו JSON תקין (${pdfPath})`); resolve([]); }
    });
    py.on("error", (e) => {
      console.error(`✗ לא ניתן להריץ python3: ${e.message}`);
      resolve([]);
    });
  });
}

/* ── auto-integration (full-automatic mode, with sanity checks) ─────────── */
let CITY_NAMES: Set<string> | null = null;
function cityNames(): Set<string> {
  if (!CITY_NAMES) {
    try {
      const codes = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data", "city_cbs_codes.json"), "utf-8"));
      CITY_NAMES = new Set(Object.keys(codes));
    } catch { CITY_NAMES = new Set(); }
  }
  return CITY_NAMES;
}

const toNum = (s: string): number | null => {
  const m = String(s).replace(/[,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
};

/**
 * Pull city rows out of extracted tables and append them as provenance-tagged
 * facts. Sanity: a fact needs exactly one known city cell + ≥1 plausible
 * number; values outside the type's range get confidence "low" (never dropped
 * silently — the user wants full-automatic, we flag instead of block).
 */
function integrateCityTables(
  tables: Array<{ page: number; rows: string[][] }>,
  meta: { title: string; sourceUrl: string; sourceName: string; published: string | null },
): number {
  const names = cityNames();
  if (!names.size || !tables.length) return 0;
  let facts: { facts: Array<Record<string, unknown>> } & Record<string, unknown>;
  try { facts = JSON.parse(fs.readFileSync(FACTS_FILE, "utf-8")); }
  catch { facts = { facts: [] }; }
  const existingKey = new Set(
    (facts.facts as Array<{ city?: string; source_url?: string }>).map((f) => `${f.city}|${f.source_url}`),
  );
  const category = /התחלות|גמר|בנייה|בניה|היתר/.test(meta.title) ? "construction"
    : /מחיר|מדד/.test(meta.title) ? "prices" : "market";
  // plausibility ranges per category (unit-level yearly numbers)
  const RANGE: Record<string, [number, number]> = {
    construction: [0, 40_000],
    prices: [1_000, 200_000],
    market: [0, 1_000_000],
  };
  let added = 0;
  for (const t of tables) {
    for (const row of t.rows) {
      const cityCells = row.filter((c) => names.has(c.trim()));
      if (cityCells.length !== 1) continue;
      const city = cityCells[0].trim();
      const nums = row.map(toNum).filter((v): v is number => v != null && Math.abs(v) < 10_000_000);
      if (!nums.length) continue;
      const key = `${city}|${meta.sourceUrl}`;
      if (existingKey.has(key)) continue;
      existingKey.add(key);
      const [lo, hi] = RANGE[category];
      const inRange = nums.some((v) => v >= lo && v <= hi);
      (facts.facts as Array<Record<string, unknown>>).push({
        city,
        category,
        fact: `${meta.title} — נתוני ${city}: ${row.filter(Boolean).join(" · ")} (עמ׳ ${t.page})`,
        source_url: meta.sourceUrl,
        source_name: meta.sourceName,
        published: meta.published,
        confidence: inRange ? "medium" : "low", // auto-extracted → never "high"
        auto_extracted: true,
      });
      added++;
    }
  }
  if (added > 0) {
    facts.lastUpdated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(FACTS_FILE, JSON.stringify(facts, null, 2), "utf-8");
  }
  return added;
}

/** MoF review text → the bullet sentences that carry numbers (highlights). */
function extractHighlights(text: string, max = 6): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && l.length < 300 && /\d/.test(l) && /[֐-׿]/.test(l))
    .slice(0, max);
}

/* ── the refresh generator ──────────────────────────────────────────────── */
export async function* refreshDataStream(opts?: {
  year?: number;
  probeBudget?: number;
}): AsyncGenerator<RefreshEvent, RefreshSummary, unknown> {
  const startedAt = new Date();
  const year = opts?.year ?? new Date().getFullYear();
  /** how many CBS numbers to probe per subject per click (catch-up pace) */
  const probeBudget = opts?.probeBudget ?? 120;

  const seen = loadSeen();
  const recent = loadRecent();
  const probe = loadProbeState(year);

  const knownIds = new Set<string>(Object.keys(seen.publications ?? {}));
  for (const r of recent.reports) knownIds.add(`${r.subject}:${r.year}:${r.publicationNumber}`);

  let attempted = 0, found = 0, skipped = 0, errors = 0;
  const newReports: RefreshSummary["newReports"] = [];
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });

  yield {
    type: "log",
    message: `🔍 סריקה מלאה: למ״ס (חלון מספרים מתגלגל) + משרד האוצר (API הפרסומים) · ${knownIds.size} פרסומים כבר במערכת`,
    data: { knownCount: knownIds.size, year },
  };

  /* ════ 1) Ministry of Finance — real listing API, title-filtered ════ */
  try {
    yield { type: "log", message: "🏛️ משרד האוצר — שולף את רשימת הפרסומים העדכנית…" };
    const pubs = await fetchMofPublications(60);
    const relevant = pubs.filter((p) => titleIsRealEstate(p.title));
    yield { type: "log", message: `🏛️ אוצר: ${pubs.length} פרסומים אחרונים, ${relevant.length} בתחום הנדל״ן לפי כותרת` };
    for (const p of relevant) {
      const id = `mof:${p.slug}`;
      attempted++;
      if (seen.publications![id]) { skipped++; continue; }
      try {
        const content = await fetchGovilPageContent(p.slug);
        const highlights = extractHighlights(content.text);
        // keep the extracted text for downstream processing + audit
        fs.writeFileSync(path.join(EXTRACT_DIR, `${p.slug}.txt`), content.text, "utf-8");
        const entry: RecentReportEntry = {
          id,
          title: p.title,
          publicationNumber: p.slug,
          subject: "mof",
          year: Number(p.publishedDate?.slice(0, 4)) || year,
          publisher: "MoF",
          publishedDate: p.publishedDate,
          pdfUrl: content.files[0]?.url ?? p.pageUrl,
          primaryPdfPath: null, // MoF blob is Cloudflare-gated — link out to gov.il
          discoveredAt: new Date().toISOString(),
          preview: content.text.slice(0, 800),
          highlights,
        };
        recent.reports.unshift(entry);
        seen.publications![id] = new Date().toISOString();
        found++;
        newReports.push({ publicationNumber: p.slug, subject: "mof", title: p.title, pdfUrl: entry.pdfUrl, localPath: "" });
        yield { type: "found", message: `✓ אוצר — ${p.title} (${p.publishedDate ?? "ללא תאריך"})`, data: { id, highlights: highlights.slice(0, 2) } };
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        errors++;
        yield { type: "error", message: `✗ אוצר ${p.slug}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  } catch (err) {
    errors++;
    yield { type: "error", message: `✗ שליפת פרסומי האוצר נכשלה: ${err instanceof Error ? err.message : String(err)}` };
  }

  /* ════ 2) CBS — rolling number window that actually advances ════ */
  // CBS publication numbers are one GLOBAL yearly sequence shared by all
  // subjects; each subject only "owns" some numbers. A miss on subject S at
  // number N is closed permanently once ANY subject finds a number > N
  // (the sequence has moved past it) — this is what un-freezes the window.
  const subjects: SubjectKey[] = ["prices", "construction"];
  const globalMax = () => Math.max(0, ...Object.values(probe.maxFound));

  const processCbsFind = async function* (d: { publicationNumber: string; year: number; subject: SubjectKey; url: string; localPath?: string }) {
    const num = parseInt(d.publicationNumber, 10);
    probe.maxFound[d.subject] = Math.max(probe.maxFound[d.subject] ?? 0, num);
    try {
      const text = await extractPdfText(d.localPath!);
      const { title, publishedDate } = extractTitleAndDate(text);
      const id = `${d.subject}:${d.year}:${d.publicationNumber}`;
      // TITLE-based relevance (fix #2) — the CPI release dies here
      if (!titleIsRealEstate(title)) {
        try { fs.unlinkSync(d.localPath!); } catch { /* gone */ }
        try { fs.unlinkSync(path.join(process.cwd(), "public", "reports", path.basename(d.localPath!))); } catch { /* gone */ }
        seen.publications![id] = new Date().toISOString();
        knownIds.add(id);
        yield { type: "skip" as const, message: `⊘ ${d.publicationNumber}/${d.year} — "${title.slice(0, 60)}" לא בתחום לפי הכותרת` };
        return;
      }
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
      newReports.push({ publicationNumber: d.publicationNumber, subject: d.subject, title, pdfUrl: d.url, localPath: entry.primaryPdfPath! });
      found++;
      yield { type: "found" as const, message: `✓ למ״ס ${d.publicationNumber}/${d.year} — ${title}`, data: { id, publishedDate } };

      // full-automatic integration: tables → city facts (provenance-tagged)
      const tables = await extractPdfTables(d.localPath!);
      if (tables.length) {
        fs.writeFileSync(path.join(EXTRACT_DIR, `cbs_${d.publicationNumber}_${d.year}.tables.json`),
          JSON.stringify({ source: d.url, title, tables }, null, 2), "utf-8");
        const added = integrateCityTables(tables, {
          title, sourceUrl: d.url, sourceName: `למ"ס, ${title}`, published: publishedDate,
        });
        if (added > 0) {
          yield { type: "parsed" as const, message: `📊 חולצו ${tables.length} טבלאות → ${added} עובדות-עיר נוספו (confidence: medium, מתויג מקור)` };
        }
      }
    } catch (err) {
      errors++;
      yield { type: "error" as const, message: `✗ עיבוד ${d.publicationNumber} נכשל: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  for (const subject of subjects) {
    const maxFoundS = probe.maxFound[subject] ?? 0;
    probe.misses[subject] = probe.misses[subject] ?? {};
    const closedSet = new Set(probe.closed[subject] ?? []);

    // seed from the legacy registry so an upgraded system doesn't rescan finds
    for (const id of knownIds) {
      const [s, y, num] = id.split(":");
      if (s === subject && parseInt(y, 10) === year) {
        probe.maxFound[subject] = Math.max(probe.maxFound[subject] ?? 0, parseInt(num, 10));
      }
    }

    // Candidates: (a) fresh tail beyond the subject's frontier, (b) catch-up
    // numbers we haven't closed yet, all bounded by the per-click budget.
    const candidates: string[] = [];
    const start = Math.max(maxFoundS, 39) + 1;
    for (let n = start; candidates.length < probeBudget && n <= start + 400; n++) {
      const key = String(n).padStart(3, "0");
      if (closedSet.has(key)) continue;
      if (knownIds.has(`${subject}:${year}:${key}`)) continue;
      const missCount = probe.misses[subject][key] ?? 0;
      // closing rule: the global sequence moved past it and it missed twice+
      if (n <= globalMax() && missCount >= 2) { closedSet.add(key); continue; }
      if (missCount >= 4) { closedSet.add(key); continue; } // hard cap
      candidates.push(key);
    }
    probe.closed[subject] = [...closedSet];

    yield {
      type: "log",
      message: `📋 למ״ס ${subjectHebrew(subject)} — בודק ${candidates.length} מספרים (${candidates[0] ?? "—"}→${candidates[candidates.length - 1] ?? "—"}) · חזית: ${probe.maxFound[subject] ?? 0}`,
      data: { subject, count: candidates.length },
    };

    // control = the subject's own frontier PDF (known to exist). CBS serves the
    // SAME error page for "not published" and "rate-limited", so misses count
    // only after the control verifies the pipe was actually open.
    const ctlNum = probe.maxFound[subject] ?? 0;
    const controlUrl = ctlNum > 0 ? buildCbsPdfUrl(year, String(ctlNum).padStart(3, "0"), subject) : undefined;
    const { reports: discovered, throttled, confirmedMisses } = await discoverCbsReports({
      year, subject, numbers: candidates, knownIds, controlUrl,
    });
    for (const num of confirmedMisses) {
      probe.misses[subject][num] = (probe.misses[subject][num] ?? 0) + 1; // fix #1: record VERIFIED misses
    }
    attempted += candidates.length;
    skipped += candidates.length - discovered.length;

    for (const d of discovered) {
      yield* processCbsFind(d);
    }
    if (throttled) {
      yield {
        type: "log",
        message: `⏳ למ״ס האט את הקצב (הגנת עומס) — הסריקה נעצרה בנקודה הזו ותמשיך מכאן בלחיצה הבאה; אף מספר לא סומן כחסר בטעות`,
      };
    }
    saveProbeState(probe); // persist between subjects — a killed run keeps its progress
  }

  /* ════ persist ════ */
  recent.lastRefreshedAt = new Date().toISOString();
  recent.reports = recent.reports.slice(0, 80);
  saveRecent(recent);
  saveSeen(seen);
  saveProbeState(probe);

  const finishedAt = new Date();
  const summary: RefreshSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempted, found, skipped, errors, newReports,
  };
  yield {
    type: "summary",
    message: found > 0
      ? `🎉 הסתיים: ${found} פרסומים חדשים (למ״ס + אוצר) · ${skipped} דולגו/חסרים · ${errors} שגיאות · ${Math.round(summary.durationMs / 1000)} שנ׳`
      : `✓ הסתיים: אין פרסומים חדשים בחלון שנסרק (${attempted} נבדקו) · החלון התקדם ויימשך בלחיצה הבאה · ${Math.round(summary.durationMs / 1000)} שנ׳`,
    data: summary as unknown as Record<string, unknown>,
  };
  yield { type: "done", message: "done" };
  return summary;
}

function subjectHebrew(s: SubjectKey): string {
  if (s === "prices") return "מחירי דירות (מדד)";
  if (s === "construction") return "התחלות וגמר בנייה";
  return "אוכלוסייה";
}
