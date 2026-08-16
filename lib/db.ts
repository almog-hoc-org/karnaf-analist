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
  const client = new PrismaClient({ adapter } as any);

  // WAIT for the writer instead of failing in front of a visitor.
  //
  // busy_timeout is PER CONNECTION, and every pipeline script sets 60s on its
  // own (merge-cross-channel, import-transactions, classify-sale-channel, …)
  // — this one, the connection that serves every page, was left at SQLite's
  // default of 0. So during the 02:30 aggregation's write transaction a page
  // render did not queue behind it, it got SQLITE_BUSY immediately and threw.
  // Ten seconds is far longer than any single write here takes and far shorter
  // than a visitor's patience.
  //
  // Fire-and-forget: the pragma is a plain statement on the same connection,
  // and a failure to set it must not stop the app from booting.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$executeRawUnsafe("PRAGMA busy_timeout = 10000")
    .catch(() => { /* pragma unsupported or DB not reachable yet — not fatal */ });

  return client;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
