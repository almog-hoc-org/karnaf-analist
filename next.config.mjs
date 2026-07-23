/** @type {import('next').NextConfig} */
const nextConfig = {
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
