/**
 * CBS publication fetcher.
 *
 * CBS press releases live at URL patterns like:
 *   https://www.cbs.gov.il/he/mediarelease/DocLib/{YYYY}/{NNN}/{SS}_{YY}_{NNN}b.pdf
 *   https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/{YYYY}/{NNN}/{SS}_{YY}_{NNN}b.pdf
 *
 * Where:
 *   YYYY = full year, e.g. 2026
 *   YY   = short year, e.g. 26
 *   NNN  = publication number (zero-padded to 3 digits)
 *   SS   = subject code: 04 = construction, 10 = price index (madad), 01 = population
 *
 * Key technical notes:
 *   • CBS blocks HTTP/2 requests from generic clients — must use --http1.1 (Node's
 *     fetch defaults to HTTP/1.1, so this is automatic).
 *   • CBS requires a real browser UA. We use a Safari UA string.
 *   • Empty publication numbers return a 2KB SharePoint stub. A valid PDF is ≥10KB
 *     and starts with "%PDF" header bytes.
 */
import fs from "fs";
import path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export type SubjectCode = "04" | "10" | "01"; // construction | madad | population
export type SubjectKey = "construction" | "prices" | "population";

const SUBJECT_TO_CODE: Record<SubjectKey, SubjectCode> = {
  construction: "04",
  prices: "10",
  population: "01",
};

const SUBJECT_TO_FOLDER: Record<SubjectKey, string> = {
  construction: "DocLib",
  prices: "Madad/DocLib",
  population: "DocLib",
};

export interface DiscoveredReport {
  publicationNumber: string; // "047"
  year: number;
  subject: SubjectKey;
  url: string;
  /** Bytes of the downloaded PDF, only present if we successfully downloaded. */
  pdfBytes?: Uint8Array;
  /** Local filesystem path if saved. */
  localPath?: string;
}

export function buildCbsPdfUrl(year: number, num: string, subject: SubjectKey): string {
  const shortYear = year % 100;
  const subjectCode = SUBJECT_TO_CODE[subject];
  const folder = SUBJECT_TO_FOLDER[subject];
  // Examples:
  //   construction: https://www.cbs.gov.il/he/mediarelease/DocLib/2026/089/04_26_089b.pdf
  //   prices:       https://www.cbs.gov.il/he/mediarelease/Madad/DocLib/2026/142/10_26_142b.pdf
  return `https://www.cbs.gov.il/he/mediarelease/${folder}/${year}/${num}/${subjectCode}_${shortYear}_${num}b.pdf`;
}

/**
 * Try to download a single CBS PDF. Returns null on failure.
 * Validates that the response is a real PDF (≥10KB + correct magic header).
 */
export async function tryDownloadCbsPdf(
  year: number,
  num: string,
  subject: SubjectKey
): Promise<Uint8Array | null> {
  const url = buildCbsPdfUrl(year, num, subject);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/pdf,*/*",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Stub responses are ~2KB; real PDFs ≥10KB and start with %PDF
    if (bytes.length < 10_000) return null;
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Extract text from a PDF file by spawning Python with PyMuPDF (fitz).
 * Returns concatenated text from all pages.
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const { spawn } = await import("child_process");
  return new Promise((resolve, reject) => {
    const py = spawn("python3", [
      "-c",
      `import fitz, sys; doc = fitz.open(sys.argv[1]); print("\\n--PAGE--\\n".join(p.get_text() for p in doc))`,
      pdfPath,
    ]);
    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));
    py.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pdf extract failed: ${stderr}`));
    });
  });
}

/**
 * Persist a downloaded PDF to disk under public/reports/ (for serving) +
 * data/reports/recent/ (for local processing).
 */
export function savePdf(bytes: Uint8Array, filename: string): { publicPath: string; localPath: string } {
  const projectRoot = process.cwd();
  const publicDir = path.join(projectRoot, "public", "reports");
  const localDir = path.join(projectRoot, "data", "reports", "recent");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
  const publicPath = path.join(publicDir, filename);
  const localPath = path.join(localDir, filename);
  fs.writeFileSync(publicPath, bytes);
  fs.writeFileSync(localPath, bytes);
  return { publicPath, localPath };
}

/**
 * Search a range of publication numbers for new CBS reports.
 *
 * Strategy: for each (year, subject) pair, iterate publication numbers in the
 * given range. Skip any (subject, year, num) tuple already in `knownIds`.
 * Return the list of discovered new reports (downloaded into memory + saved).
 *
 * onProgress is invoked per attempted number — useful for streaming UI.
 */
export interface DiscoveryOptions {
  year: number;
  subject: SubjectKey;
  /** Publication numbers to probe, e.g. ["140", "141", "142", "143", "144", "145"]. */
  numbers: string[];
  /** Set of "{subject}:{year}:{num}" already in the system. */
  knownIds: Set<string>;
  /**
   * URL of a PDF KNOWN to exist (e.g. the subject's last find). CRITICAL for
   * correctness: CBS serves the SAME ~2KB error page for "number not
   * published" and for "you are rate-limited" (verified 2026-07-30 — a long
   * scan silently turned every real PDF into a phantom miss). We re-fetch the
   * control every few probes; when it fails, the pipe is throttled and every
   * unverified miss since the last good control is DISCARDED, not recorded.
   */
  controlUrl?: string;
  onProgress?: (event: { num: string; status: "skipped" | "tried" | "found" | "miss" | "throttled" }) => void;
}

export interface DiscoveryResult {
  reports: DiscoveredReport[];
  /** true → the scan stopped early because CBS started rejecting requests */
  throttled: boolean;
  /** numbers whose absence was VERIFIED (safe to count as real misses) */
  confirmedMisses: string[];
}

async function urlAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length >= 10_000 && bytes[0] === 0x25 && bytes[1] === 0x50;
  } catch {
    return false;
  }
}

export async function discoverCbsReports(opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const out: DiscoveredReport[] = [];
  const confirmedMisses: string[] = [];
  /** misses awaiting verification (flushed on a find or a good control check) */
  let pendingMisses: string[] = [];
  let sinceCheck = 0;
  let throttled = false;
  let recoveryUsed = false;
  const CHECK_EVERY = 15;

  const flushPending = () => {
    for (const n of pendingMisses) { confirmedMisses.push(n); opts.onProgress?.({ num: n, status: "miss" }); }
    pendingMisses = [];
  };

  for (const num of opts.numbers) {
    const id = `${opts.subject}:${opts.year}:${num}`;
    if (opts.knownIds.has(id)) {
      opts.onProgress?.({ num, status: "skipped" });
      continue;
    }
    opts.onProgress?.({ num, status: "tried" });
    const bytes = await tryDownloadCbsPdf(opts.year, num, opts.subject);
    if (bytes) {
      // a real download proves the pipe is open → everything before it was a true miss
      flushPending();
      sinceCheck = 0;
      const filename = `cbs_${num}_${opts.year}_${opts.subject}.pdf`;
      const { localPath } = savePdf(bytes, filename);
      out.push({
        publicationNumber: num,
        year: opts.year,
        subject: opts.subject,
        url: buildCbsPdfUrl(opts.year, num, opts.subject),
        pdfBytes: bytes,
        localPath,
      });
      opts.onProgress?.({ num, status: "found" });
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    pendingMisses.push(num);
    sinceCheck++;
    if (opts.controlUrl && sinceCheck >= CHECK_EVERY) {
      sinceCheck = 0;
      if (await urlAlive(opts.controlUrl)) {
        flushPending(); // pipe verified open → those were real misses
      } else if (!recoveryUsed) {
        // throttled once → cool down and try to continue the same run
        recoveryUsed = true;
        opts.onProgress?.({ num, status: "throttled" });
        await new Promise((r) => setTimeout(r, 45_000));
        if (await urlAlive(opts.controlUrl)) {
          flushPending();
        } else {
          pendingMisses = []; // unverifiable — do NOT poison the registry
          throttled = true;
          break;
        }
      } else {
        pendingMisses = [];
        throttled = true;
        break;
      }
    }
    // 900ms pause between probes — CBS rate-limits aggressively
    await new Promise((r) => setTimeout(r, 900));
  }

  // tail: verify the pipe once more before trusting the final streak
  if (!throttled && pendingMisses.length) {
    if (!opts.controlUrl || (await urlAlive(opts.controlUrl))) flushPending();
    else { pendingMisses = []; throttled = true; }
  }
  return { reports: out, throttled, confirmedMisses };
}
