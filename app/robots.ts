import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

/**
 * Crawl directives. There were none, so crawlers were free to spend the budget
 * on the personal workspace and the admin login while the 168 city pages went
 * undiscovered.
 *
 * The disallow list is about waste and privacy, not secrecy — every one of
 * these is already access-controlled server-side. /deals is a broker's private
 * client data, /admin and /api are machine surfaces, and /compare?cities=…
 * generates unbounded permutations of the same page, which is the classic way
 * to burn a crawl budget on duplicates.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/deals", "/admin", "/api/", "/account", "/login", "/register", "/logout"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
