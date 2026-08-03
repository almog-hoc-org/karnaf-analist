import { ProxyAgent } from "undici";

/**
 * fetch() that can be routed through an Israeli egress, for the sources that
 * refuse to answer anyone else.
 *
 * WHY THIS EXISTS — MEASURED, NOT GUESSED
 * The Tax Authority's two sites (govmap.gov.il, nadlan.gov.il) sit behind
 * CloudFront with a geo rule. From this server, in Europe, EVERY path returns
 * the same ~1.7KB SPA shell: the API, and even a real static asset. The same URL
 * at the same moment from a machine in Israel returns the genuine 10MB bundle,
 * `text/javascript`. Identical headers, identical User-Agent — the only variable
 * is where the request leaves from.
 *
 * That measurement ruled out the two cheaper theories before any money was
 * spent. It is not a changed API path, so hunting for the new endpoint would
 * have found nothing. It is not User-Agent filtering, so browser headers change
 * nothing. And critically it is not something a headless Chrome in the container
 * can solve: the browser cannot even load the application, because the asset
 * bundle it needs comes back as the same HTML shell.
 *
 * The CBS and the Chief Economist are NOT affected — nineteen publications came
 * through on the first run — so this is deliberately scoped rather than global.
 * Routing everything through one proxy would put a rented box in the path of
 * sources that work perfectly well without it.
 *
 * INERT WITHOUT CONFIGURATION. No KARNAF_IL_PROXY, no proxy: this is exactly
 * plain fetch, same behaviour, no new failure mode. Setting the variable is the
 * entire switch.
 *
 *   KARNAF_IL_PROXY=http://user:pass@host:port
 */

let agent: ProxyAgent | null = null;
let announced = false;

/** The hosts that need it. Anything else should use plain fetch. */
export const GEO_RESTRICTED_HOSTS = ["govmap.gov.il", "nadlan.gov.il"];

export function ilProxyUrl(): string | undefined {
  return process.env.KARNAF_IL_PROXY || undefined;
}

/**
 * A one-line note the first time a process routes through the proxy.
 *
 * Worth the noise: "the collector worked" and "the collector worked THROUGH the
 * Israeli egress" are different facts, and only one of them survives someone
 * removing the environment variable.
 */
function announce(url: string) {
  if (announced) return;
  announced = true;
  // Never print credentials — a proxy URL usually carries user:pass.
  let where = "(לא ניתן לפרסר)";
  try { const u = new URL(url); where = `${u.protocol}//${u.host}`; } catch { /* keep the placeholder */ }
  console.log(`↪ יציאה ישראלית פעילה: ${where}`);
}

/**
 * fetch, through the Israeli egress when one is configured.
 *
 * Use for the geo-restricted hosts only. Everything else should call fetch
 * directly, so a proxy outage cannot take down sources that never needed it.
 */
export function ilFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const proxy = ilProxyUrl();
  if (!proxy) return fetch(url, init);
  if (!agent) agent = new ProxyAgent(proxy);
  announce(proxy);
  // `dispatcher` is undici's per-request escape hatch, honoured by Node's
  // built-in fetch. Scoping it per call keeps the global dispatcher untouched,
  // so an unrelated fetch elsewhere in the process is unaffected.
  return fetch(url, { ...init, dispatcher: agent } as RequestInit);
}

/** True when this URL is one of the hosts that needs the Israeli egress. */
export function needsIlEgress(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return GEO_RESTRICTED_HOSTS.some((g) => h === g || h.endsWith(`.${g}`));
  } catch {
    return false;
  }
}
