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
  onProgress?: (event: { num: string; status: "skipped" | "tried" | "found" | "miss" }) => void;
}

export async function discoverCbsReports(
  opts: DiscoveryOptions
): Promise<DiscoveredReport[]> {
  const out: DiscoveredReport[] = [];
  for (const num of opts.numbers) {
    const id = `${opts.subject}:${opts.year}:${num}`;
    if (opts.knownIds.has(id)) {
      opts.onProgress?.({ num, status: "skipped" });
      continue;
    }
    opts.onProgress?.({ num, status: "tried" });
    const bytes = await tryDownloadCbsPdf(opts.year, num, opts.subject);
    if (!bytes) {
      opts.onProgress?.({ num, status: "miss" });
      // 800ms pause between probes — CBS rate-limits at ~1.5/sec
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    const filename = `cbs_${num}_${opts.year}_${opts.subject}.pdf`;
    const { publicPath, localPath } = savePdf(bytes, filename);
    out.push({
      publicationNumber: num,
      year: opts.year,
      subject: opts.subject,
      url: buildCbsPdfUrl(opts.year, num, opts.subject),
      pdfBytes: bytes,
      localPath,
    });
    opts.onProgress?.({ num, status: "found" });
    // Larger pause after a successful find (download was bandwidth-heavy)
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}
