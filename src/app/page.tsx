import { prisma } from "@/lib/db";
import SearchBar from "@/components/SearchBar";
import RankingCard from "@/components/RankingCard";
import Link from "next/link";

interface PageProps {
  searchParams: { q?: string };
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("he-IL");
}

export default async function HomePage({ searchParams }: PageProps) {
  const query = searchParams.q?.trim() ?? "";

  // Check if DB has any data
  let cityCount = 0;
  let lastUpdated: Date | null = null;

  try {
    cityCount = await prisma.city.count();
    if (cityCount > 0) {
      const latest = await prisma.city.findFirst({
        orderBy: { last_updated: "desc" },
        select: { last_updated: true },
      });
      lastUpdated = latest?.last_updated ?? null;
    }
  } catch {
    // DB not ready
  }

  if (cityCount === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-5xl mb-6">🏗️</div>
          <h1 className="text-2xl font-bold text-zinc-100">
            אין נתונים במערכת
          </h1>
          <p className="text-zinc-400 text-lg">
            נא להריץ את סקריפט הייבוא.
          </p>
          <code className="block mt-4 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-cyan-400 text-sm">
            npx tsx src/lib/import.ts
          </code>
        </div>
      </main>
    );
  }

  // ── Search mode ───────────────────────────────────────────────────────────
  if (query) {
    const results = await prisma.city.findMany({
      where: {
        city_name: { contains: query },
      },
      orderBy: { city_name: "asc" },
      take: 20,
    });

    return (
      <main className="min-h-screen px-4 py-10 max-w-4xl mx-auto">
        <Hero query={query} />

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-300 mb-4">
            תוצאות חיפוש עבור &ldquo;{query}&rdquo; ({results.length} ערים)
          </h2>

          {results.length === 0 ? (
            <p className="text-zinc-500">לא נמצאו ערים תואמות.</p>
          ) : (
            <div className="grid gap-3">
              {results.map((city) => (
                <Link
                  key={city.id}
                  href={`/city/${encodeURIComponent(city.city_name)}`}
                  className="flex items-center justify-between px-5 py-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-cyan-800 hover:bg-zinc-800 transition-all duration-200 group"
                >
                  <span className="font-semibold text-zinc-100 group-hover:text-cyan-400 transition-colors">
                    {city.city_name}
                  </span>
                  <div className="flex gap-6 text-sm text-zinc-400">
                    <span>
                      מחיר 2026:{" "}
                      <span className="text-zinc-200">
                        {formatPrice(city.price_per_sqm_2026)}
                      </span>
                    </span>
                    <span>
                      שינוי:{" "}
                      <span
                        className={
                          (city.price_change_pct ?? 0) >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {formatPct(city.price_change_pct)}
                      </span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <Footer lastUpdated={lastUpdated} />
      </main>
    );
  }

  // ── Rankings mode ─────────────────────────────────────────────────────────
  const [mostExpensive, highestGain, highestSurplus, highestDeficit, highestInventory] =
    await Promise.all([
      // 1. Most expensive per sqm
      prisma.city.findMany({
        where: { price_per_sqm_2026: { not: null } },
        orderBy: { price_per_sqm_2026: "desc" },
        take: 5,
        select: { city_name: true, price_per_sqm_2026: true },
      }),

      // 2. Highest price change
      prisma.city.findMany({
        where: { price_change_pct: { not: null } },
        orderBy: { price_change_pct: "desc" },
        take: 5,
        select: { city_name: true, price_change_pct: true },
      }),

      // 3. Highest supply surplus (golden_pct > 0)
      prisma.city.findMany({
        where: { golden_pct: { gt: 0 } },
        orderBy: { golden_pct: "desc" },
        take: 5,
        select: { city_name: true, golden_pct: true },
      }),

      // 4. Highest supply deficit (golden_pct < 0)
      prisma.city.findMany({
        where: { golden_pct: { lt: 0 } },
        orderBy: { golden_pct: "asc" },
        take: 5,
        select: { city_name: true, golden_pct: true },
      }),

      // 5. Highest unsold inventory
      prisma.citySales.findMany({
        where: { unsold_inventory_2025: { not: null } },
        orderBy: { unsold_inventory_2025: "desc" },
        take: 5,
        select: { city_name: true, unsold_inventory_2025: true },
      }),
    ]);

  const rankings = [
    {
      title: 'יקרות ביותר למ"ר',
      items: mostExpensive.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatPrice(c.price_per_sqm_2026),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "עליית מחיר גבוהה ביותר 2023→2026",
      items: highestGain.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatPct(c.price_change_pct),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "עודף היצע הגבוה ביותר",
      items: highestSurplus.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: c.golden_pct !== null ? `+${c.golden_pct.toFixed(1)}%` : "—",
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "גרעון היצע הגבוה ביותר",
      items: highestDeficit.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: c.golden_pct !== null ? `${c.golden_pct.toFixed(1)}%` : "—",
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
    {
      title: "מלאי דירות לא מכורות גבוה ביותר",
      items: highestInventory.map((c, i) => ({
        rank: i + 1,
        city: c.city_name,
        value: formatNumber(c.unsold_inventory_2025),
        href: `/city/${encodeURIComponent(c.city_name)}`,
      })),
    },
  ];

  return (
    <main className="min-h-screen px-4 py-10 max-w-6xl mx-auto">
      <Hero query={query} />

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {rankings.map((ranking) => (
          <RankingCard
            key={ranking.title}
            title={ranking.title}
            items={ranking.items}
          />
        ))}
      </div>

      <Footer lastUpdated={lastUpdated} />
    </main>
  );
}

// ── Sub-components (server-renderable) ────────────────────────────────────────

function Hero({ query }: { query: string }) {
  return (
    <header className="text-center space-y-6 pb-6">
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-widest text-cyan-500 uppercase">
          Research Dashboard
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
          מחקר נדל&quot;ן ישראל
        </h1>
        <p className="text-zinc-400 text-lg">
          ניתוח מעמיק של שוק הדיור — מחירים, היצע וביקוש
        </p>
      </div>

      <div className="max-w-xl mx-auto">
        <SearchBar initialQuery={query} />
      </div>
    </header>
  );
}

function Footer({ lastUpdated }: { lastUpdated: Date | null }) {
  const formatted = lastUpdated
    ? lastUpdated.toLocaleDateString("he-IL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "לא ידוע";

  return (
    <footer className="mt-16 pt-8 border-t border-zinc-800 text-center text-zinc-500 text-sm">
      מקור: קובץ מחקר פנימי | עודכן לאחרונה: {formatted}
    </footer>
  );
}
