/**
 * gov.il publications fetcher — Ministry of Finance (Chief Economist).
 *
 * DISCOVERED LIVE 2026-07-30 (the old scraper returned zero because
 * www.gov.il is a Cloudflare-challenged SPA — its HTML carries no links):
 *   • The SPA's real data API lives on a SEPARATE, unchallenged host:
 *       https://openapi-gc.digital.gov.il/pub/cio/govil/rest/collectors/v1/
 *     Requires headers: `x-client-id` (public key baked into the site's own
 *     /CollectorsWebApi/client-config.js) + `Origin: https://www.gov.il`.
 *   • GetResults?CollectorType=reports&OfficeId=<GUID>&skip&limit&culture=he
 *     → { total, results: [{ title, url:"/he/pages/<slug>", tags.metaData }] }
 *   • MoF OfficeId GUID (verified): f41159c1-7867-41c3-bc0a-cbfe0da1bb1a
 *     (the GUID previously hard-coded in lib/sources.ts returned 0 results).
 *   • Page content: .../contentpage/v1/api/content-pages/<slug>?culture=he
 *     → full review HTML in contentMain.htmlContents[].sectionData + the PDF
 *     attachment list. The PDF blob itself (www.gov.il/BlobFolder/...) is
 *     Cloudflare-blocked for plain HTTP, so we extract from the HTML content
 *     (which carries the review's headline numbers) and link out to the page.
 */

const API_BASE = "https://openapi-gc.digital.gov.il/pub/cio/govil/rest";
/** Public client key served to every browser via /CollectorsWebApi/client-config.js */
const CLIENT_ID = "9KFgciHHGDyNiqz5MdQS0eK2ApeJYMc6YnElUICpN1atirZc";
/** משרד האוצר (verified via GetOfficesList, 2026-07-30) */
export const MOF_OFFICE_ID = "f41159c1-7867-41c3-bc0a-cbfe0da1bb1a";

const HEADERS: Record<string, string> = {
  "x-client-id": CLIENT_ID,
  Origin: "https://www.gov.il",
  Referer: "https://www.gov.il/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export interface GovilPublication {
  title: string;
  /** absolute page URL on www.gov.il */
  pageUrl: string;
  /** the content-pages slug ("review-real-estate-052026-main") */
  slug: string;
  /** ISO date (from metaData "תאריך פרסום", dd.mm.yyyy) or null */
  publishedDate: string | null;
  /** publishing unit, e.g. "הכלכלן הראשי" */
  unit: string | null;
}

interface RawResult {
  title?: string;
  url?: string;
  tags?: { metaData?: Record<string, Array<{ title?: string }>> };
}

function parseHebDate(s: string | undefined): string | null {
  const m = s?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * List MoF "reports" publications, newest first (the collector's own order).
 * Pages through skip/limit until `limit` items or the well runs dry.
 */
export async function fetchMofPublications(limit = 60): Promise<GovilPublication[]> {
  const out: GovilPublication[] = [];
  const PAGE = 20;
  for (let skip = 0; skip < limit; skip += PAGE) {
    const url =
      `${API_BASE}/collectors/v1/api/DataCollector/GetResults` +
      `?CollectorType=reports&OfficeId=${MOF_OFFICE_ID}&culture=he&skip=${skip}&limit=${PAGE}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`gov.il GetResults HTTP ${res.status}`);
    const data = (await res.json()) as { total?: number; results?: RawResult[] };
    const results = data.results ?? [];
    for (const r of results) {
      const u = r.url ?? "";
      const slugMatch = u.match(/\/pages\/([^/?#]+)/);
      if (!r.title || !slugMatch) continue;
      const md = r.tags?.metaData ?? {};
      out.push({
        title: r.title.replace(/\s+/g, " ").trim(),
        pageUrl: `https://www.gov.il${u}`,
        slug: slugMatch[1],
        publishedDate: parseHebDate(md["תאריך פרסום"]?.[0]?.title),
        unit: md["יחידות"]?.[0]?.title ?? null,
      });
    }
    if (results.length < PAGE) break; // last page
    await new Promise((r) => setTimeout(r, 400)); // polite pacing
  }
  return out;
}

export interface GovilPageContent {
  /** all section HTML joined, tags stripped → plain text */
  text: string;
  /** raw HTML sections (kept for table-aware parsing) */
  html: string[];
  /** downloadable attachments (PDF lives on the CF-blocked blob host — link out) */
  files: Array<{ fileName: string; url: string }>;
}

/** Fetch a publication page's full content via the unchallenged content API. */
export async function fetchGovilPageContent(slug: string): Promise<GovilPageContent> {
  const url = `${API_BASE}/contentpage/v1/api/content-pages/${encodeURIComponent(slug)}?culture=he`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`gov.il content-pages HTTP ${res.status}`);
  const data = (await res.json()) as {
    contentMain?: { htmlContents?: Array<{ sectionData?: string }> };
    contentSub?: { filesToDownload?: { filesGroupItems?: Array<{ items?: Array<{ fileName?: string; url?: string }> }> } };
  };
  const html = (data.contentMain?.htmlContents ?? [])
    .map((s) => s.sectionData ?? "")
    .filter(Boolean);
  const text = html
    .join("\n")
    .replace(/<(br|\/p|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  const files: Array<{ fileName: string; url: string }> = [];
  for (const g of data.contentSub?.filesToDownload?.filesGroupItems ?? []) {
    for (const it of g.items ?? []) {
      if (it.url) files.push({ fileName: it.fileName ?? "", url: it.url });
    }
  }
  return { text, html, files };
}
