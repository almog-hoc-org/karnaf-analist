/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', '@prisma/adapter-better-sqlite3'],
    // Bundle the SQLite database into serverless functions on Vercel
    outputFileTracingIncludes: {
      '/**/*': ['./data/realestate.db'],
    },
  },
};

export default nextConfig;
