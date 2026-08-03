import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

function createPrismaClient() {
  // KARNAF_DATA_DIR lets a collector write somewhere other than the working
  // database. That is what makes a quarterly delta possible: the Mac collects
  // the recent window into a small scratch file and ships only that, instead of
  // pulling 312MB down and pushing 312MB back to add a few months of deals.
  //
  // Unset, and on the server where it is /app/data with cwd /app, this resolves
  // to exactly the same path as before — no behaviour change anywhere.
  const dbPath = path.resolve(
    process.env.KARNAF_DATA_DIR ?? path.join(process.cwd(), "data"),
    "realestate.db"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaBetterSqlite3({ url: dbPath } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
