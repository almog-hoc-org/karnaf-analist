import type { Metadata } from "next";

/**
 * Page metadata with a canonical of its own.
 *
 * The root layout sets `alternates.canonical: '/'` and `openGraph.url: '/'`
 * for the home page, and Next hands both down to every page that does not
 * override them — so /national, /cities, /sources and a dozen more declared
 * themselves copies of the home page, with the home page's share card. A
 * page that goes through here names its path once and gets a canonical, an
 * Open Graph block and a Twitter card that agree with it. The brand suffix
 * comes from the layout's title template and is not repeated here.
 */
export function pageMeta(opts: { path: string; title: string; description?: string; index?: boolean }): Metadata {
  const { path, title, description, index = true } = opts;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: path },
    openGraph: {
      title,
      ...(description ? { description } : {}),
      url: path, // resolved against metadataBase in the root layout
      type: "website",
      locale: "he_IL",
      siteName: "קרנף אנליסט",
    },
    twitter: { card: "summary", title, ...(description ? { description } : {}) },
    ...(index ? {} : { robots: { index: false, follow: false } }),
  };
}
