/**
 * The nadlan.gov.il deal-data session, in one place.
 *
 * Three scripts (collect-nadlan-transactions, fill-city-years, and now the
 * address capture) talk to `api.nadlan.gov.il/deal-data` the same way: the
 * real browser passes reCAPTCHA and fires the first request; we read the
 * session token (`sk` + `token` + `base_id`) out of that request's body and
 * re-sign our own payloads with the app's HS256 secret (the app's own format,
 * reversed). Each script used to carry a private copy of the signing and
 * decoding helpers; the third copy is where a drift would have started.
 *
 * WHAT THIS IS NOT. Not a cap bypass: the token is the one the page minted
 * for the user's own session, the queries are the ones the page itself can
 * send, and the anonymous window (≤500 items per fetch_number, two fetches
 * per window) stays exactly what nadlan grants. Scripts slice the window by
 * the filters the page offers (room count, date horizon, sort order), never
 * around it.
 *
 * Node-only (crypto, zlib); the pure slicing rules live in lib/nadlanCapture.ts.
 */
import crypto from "crypto";
import zlib from "zlib";

/** HS256 key from the nadlan JS bundle (mixin_generateTokenForPayload). */
const SECRET = "90c3e620192348f1bd46fcd9138c3c68";

export const unrev = (s: string): string => s.split("").reverse().join("");
const b64url = (s: string | Buffer): string => Buffer.from(s as never).toString("base64url");

export function b64json(s: string): Record<string, unknown> | null {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}

/** The app's own body format: reversed `header.payload.signature`. */
export function signBody(payload: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: "HS256" }));
  const b = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`${h}.${b}`).digest("base64url");
  return unrev(`${h}.${b}.${sig}`);
}

/** Responses arrive either as plain JSON or as base64 gzip; either way → object. */
export function decodeDealData(txt: string): unknown {
  const t = txt.trim();
  if (!t) return null;
  if (t.startsWith("{")) { try { return JSON.parse(t); } catch { return null; } }
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(t, "base64")).toString("utf8")); } catch { return null; }
}

/** What the page put in its own request: the session we may reuse. */
export interface NadlanToken {
  base_id: unknown;
  base_name: unknown;
  sk: string;
  token: string;
}

/** The POST body the page sent → its signed payload → the token fields, or null. */
export function parseHarvestedPost(postData: string): NadlanToken | null {
  let raw = postData.trim();
  // the page sends {"##": "<body>"}; older captures saw the bare quoted body
  if (raw.startsWith("{")) {
    try { raw = String((JSON.parse(raw) as Record<string, unknown>)["##"] ?? ""); } catch { return null; }
  }
  raw = raw.replace(/^"|"$/g, "");
  const parts = unrev(raw).split(".");
  const p = parts.length >= 2 ? b64json(parts[1]) : null;
  if (!p || typeof p.sk !== "string" || typeof p.token !== "string") return null;
  return { base_id: p.base_id, base_name: p.base_name, sk: p.sk, token: p.token };
}

/** One signed query payload: the token's identity plus this query's filters. */
export function buildQueryPayload(tok: NadlanToken, extra: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  return {
    base_id: tok.base_id,
    base_name: tok.base_name,
    type_order: "dealDate_down",
    sk: tok.sk,
    token: tok.token,
    exp: nowSec + 110,
    domain: "www.nadlan.gov.il",
    ...extra,
  };
}

export interface DealDataMeta { totalRows: number | null; totalFetch: number | null }

/** The item list out of a decoded response, whichever envelope the API used. */
export function responseItems(decoded: unknown): Record<string, unknown>[] {
  if (!decoded || typeof decoded !== "object") return [];
  const d = decoded as Record<string, unknown>;
  const data = d.data as Record<string, unknown> | undefined;
  const list = (data?.items ?? d.AllResults ?? d.allResults) as unknown;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

export function responseMeta(decoded: unknown): DealDataMeta {
  const data = (decoded as { data?: Record<string, unknown> } | null)?.data;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { totalRows: num(data?.total_rows), totalFetch: num(data?.total_fetch) };
}
