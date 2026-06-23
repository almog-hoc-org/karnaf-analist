/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint errors (no-explicit-any, unused vars) shouldn't block production builds
  eslint: {
    ignoreDuringBuilds: true,
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
