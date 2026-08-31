import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import NumberCaption from "@/components/NumberCaption";
import TrendValue from "@/components/TrendValue";

/**
 * The three headline figures of the site, in TWO presentations built from ONE
 * array.
 *
 * Why two. On a wide screen these are three display cards and they earn their
 * space. On a phone they were three full-height cards stacked vertically —
 * roughly 480px of scrolling before the reader reached anything they came for.
 * The operator asked for them as a single strip directly under the search box,
 * about a line and a half tall, three across, with nothing wrapping.
 *
 * Why one array. The alternative — a phone block and a desktop block written
 * out separately — is two copies of every label, period and source string, and
 * they drift. Here a wording change is one edit and both surfaces move.
 *
 * The strip's guarantee against wrapping is structural, not hopeful: the label
 * is a `truncate` single line, the figure is `tabular-nums` and pre-formatted,
 * and nothing else is in the cell.
 */

export interface HeroKpiInput {
  totalDeals: number | null;
  deals12m: number | null;
  /** national median 3-year second-hand change, in % */
  median3y: number | null;
  /** how many cities the median above was taken across */
  medianCities: number;
  /** e.g. "2022 ← 2025" — the window the national change covers */
  window3yLabel: string | null;
  dealsUpdatedLabel?: string;
}

interface Kpi {
  key: string;
  href: string;
  icon: string;
  /** phone strip: must hold ONE line in a ~110px cell */
  short: string;
  /** desktop card */
  label: string;
  /** phone strip figure — a plain string, so it can never reflow */
  compact: string;
  /** desktop card figure */
  big: ReactNode;
  pills: ReactNode;
  caption: ReactNode;
}

const fmt = (n: number | null) => (n ? n.toLocaleString("he-IL") : "—");

function buildKpis(i: HeroKpiInput): Kpi[] {
  return [
    {
      key: "total",
      href: "/sources",
      icon: "database",
      short: "סה״כ עסקאות",
      label: 'סה"כ עסקאות במאגר',
      compact: fmt(i.totalDeals),
      big: <div className="stat-mega">{fmt(i.totalDeals)}</div>,
      pills: (
        <>
          <span className="trend-pill trend-flat">1998–2026</span>
          <span className="text-xs text-slate-500">כל העסקאות</span>
        </>
      ),
      caption: <NumberCaption source='רשות המסים + נדל"ן' period="1998–2026" updated={i.dealsUpdatedLabel} insideLink align="center" />,
    },
    {
      key: "m12",
      href: "/sources",
      icon: "handshake",
      short: "ב-12 חודשים",
      label: "עסקאות ב-12 החודשים האחרונים",
      compact: fmt(i.deals12m),
      big: <div className="stat-mega">{fmt(i.deals12m)}</div>,
      pills: <span className="trend-pill trend-flat">12 החודשים האחרונים</span>,
      caption: <NumberCaption source='רשות המסים + נדל"ן' period="12 החודשים האחרונים" updated={i.dealsUpdatedLabel} insideLink align="center" />,
    },
    {
      key: "nat3y",
      href: "/cities",
      icon: "trend-up",
      short: "יד-2 ארצי 3ש׳",
      label: "שינוי מחיר יד-2 ארצי — 3 שנים",
      compact: i.median3y == null ? "—" : `${i.median3y > 0 ? "+" : i.median3y < 0 ? "−" : ""}${Math.abs(i.median3y).toFixed(1)}%`,
      big: (
        <div className="leading-none" style={{ fontSize: "clamp(28px, 7.5vw, 44px)" }}>
          <TrendValue pct={i.median3y} className="font-extrabold tracking-tight" />
        </div>
      ),
      pills: (
        <>
          <span className="trend-pill trend-flat">יד שנייה בלבד</span>
          <span className="text-xs text-slate-500">חציון {i.medianCities} ערים</span>
        </>
      ),
      caption: (
        <NumberCaption
          source="עסקאות יד-שנייה אמיתיות · רשות המסים"
          period={`חציון שינוי 3 שנים בין הערים · ${i.window3yLabel ?? "—"}`}
          insideLink
          align="center"
        />
      ),
    },
  ];
}

/** Phone: one strip, three across, ~1.5 lines tall. */
export function HeroKpiStrip(props: HeroKpiInput & { className?: string }) {
  const kpis = buildKpis(props);
  return (
    <div className={`grid grid-cols-3 gap-1.5 sm:hidden ${props.className ?? ""}`}>
      {kpis.map((k) => (
        <Link
          key={k.key}
          href={k.href}
          className="rounded-lg border border-slate-200 bg-white px-1 py-1 text-center leading-tight"
          title={k.label}
        >
          <div className="truncate text-sm font-black tabular-nums text-slate-900">{k.compact}</div>
          <div className="truncate text-[9px] font-semibold text-slate-500">{k.short}</div>
        </Link>
      ))}
    </div>
  );
}

/** Wide screen: the three display cards, unchanged. */
export function HeroKpiCards(props: HeroKpiInput & { className?: string }) {
  const kpis = buildKpis(props);
  return (
    <section className={`card-grid hidden grid-cols-1 sm:grid sm:grid-cols-3 ${props.className ?? ""}`}>
      {kpis.map((k) => (
        <Link key={k.key} href={k.href} className="hero-kpi hero-indigo group block cursor-pointer text-center">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xl"><Icon name={k.icon} size="1em" /></span>
            <div className="stat-label min-w-0 break-words">{k.label}</div>
          </div>
          {k.big}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{k.pills}</div>
          {k.caption}
        </Link>
      ))}
    </section>
  );
}
