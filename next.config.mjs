// Optional base path, for serving the site under a sub-path of the main domain
// (e.g. karnafnadlan.com/analist). UNSET is the default and means "site at the
// domain root" — exactly the behaviour before this option existed.
//
// Everything Next does not prefix on its own — client fetch() calls, raw <a>
// anchors, redirects built from req.url, history.replaceState, links to files
// in public/ — goes through withBasePath() in lib/basePath.ts. That work is
// already done, so switching this on is a config change, not a code change.
//
// Set it BEFORE launch if it is ever going to be set: once links are indexed
// and shared, changing the URL is effectively irreversible.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath ? { basePath } : {}),
  // The project lives inside iCloud Drive; iCloud evicting files from .next
  // causes random 500s ("Unknown system error -11"). A *.nosync dir is never
  // synced/evicted by iCloud, keeping build artifacts local and stable.
  distDir: process.env.VERCEL ? ".next" : ".next.nosync",
  // Lint errors (no-explicit-any, unused vars) shouldn't block production builds
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', '@prisma/adapter-better-sqlite3'],
    // Bundle the SQLite database into serverless functions on Vercel
    outputFileTracingIncludes: {
      '/**/*': ['./data/realestate.db'],
    },
  },
};

export default nextConfig;
