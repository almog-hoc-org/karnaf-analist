import { ImageResponse } from "next/og";
import { loadCityTransactionPrices } from "@/lib/cityTransactionPrices";
import { loadCityPriceChanges } from "@/lib/price-changes";
import { canonicalCityName } from "@/lib/cityAliases";

/**
 * The card WhatsApp, Facebook and X render when someone shares a city page.
 *
 * Until this existed every share unfurled as a bare link — which matters more
 * here than on most sites: WhatsApp is the product's main distribution channel
 * (lib/share.ts builds ref-tagged wa.me links, and the whole credit economy
 * runs on referrals), so a naked link was throttling the growth loop at its
 * narrowest point.
 *
 * The card leads with the number a person actually wants: the current ₪/m²
 * and the yearly change. If the data is missing it degrades to the city name
 * and the brand — never to an error, because a failed OG route means no card
 * at all.
 */
export const runtime = "nodejs";           // needs Prisma/SQLite, not the edge
export const alt = "קרנף אנליסט — נתוני שוק הדיור";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");

export default async function Image({ params }: { params: { slug: string } }) {
  const cityName = canonicalCityName(decodeURIComponent(params.slug));

  let sqm: number | null = null;
  let changePct: number | null = null;
  let changeLabel = "";
  try {
    const [prices, changes] = await Promise.all([
      loadCityTransactionPrices(),
      loadCityPriceChanges(cityName),
    ]);
    const pr = prices.get(cityName);
    sqm = pr?.avgAllSqm ?? pr?.medianAllSqm ?? null;
    const w = changes?.change3y ?? changes?.change5y ?? null;
    if (w) {
      changePct = w.pct;
      changeLabel = `${w.fromY}–${w.toY}`;
    }
  } catch {
    // DB unreachable — fall through to the brand-only card
  }

  const up = (changePct ?? 0) >= 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", padding: "64px 72px",
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)",
          color: "white", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>קרנף אנליסט</span>
          <span style={{ fontSize: 34 }}>🦏</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ fontSize: 78, fontWeight: 900, lineHeight: 1.05 }}>{cityName}</div>
          {sqm ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, direction: "rtl" }}>
              <span style={{ fontSize: 64, fontWeight: 900 }}>₪{fmt(sqm)}</span>
              <span style={{ fontSize: 30, opacity: 0.85 }}>למ״ר</span>
              {changePct !== null && (
                <span style={{ fontSize: 34, fontWeight: 800, color: up ? "#6ee7b7" : "#fca5a5" }}>
                  {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}%
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 34, opacity: 0.9 }}>נתוני שוק הדיור — עסקאות, מחירים והיצע</div>
          )}
          {changeLabel && (
            <div style={{ fontSize: 24, opacity: 0.7 }}>שינוי מחיר {changeLabel}</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 24, opacity: 0.75 }}>
          עסקאות אמת מרשות המסים · נתוני למ״ס · analyst.karnafnadlan.com
        </div>
      </div>
    ),
    size
  );
}
