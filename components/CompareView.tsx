"use client";

/**
 * /compare — side-by-side comparison of 2–4 cities (core investor workflow).
 *
 * URL-state: ?cities=a,b,c (each name encodeURIComponent-ed, comma-separated).
 * Selection changes update the URL shallowly via window.history.replaceState —
 * Next 14.2 App Router syncs this natively — so links stay shareable WITHOUT
 * re-running the (heavy) server data fetch on every picker click. Initial
 * selection arrives from the server page's searchParams.
 *
 * Design: unified indigo/slate only. Green/red appear ONLY through TrendValue /
 * trendTextClass (trend semantics). Chart series colors come from SERIES so the
 * picker dot, chart line and table column all agree per city.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/track";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { SERIES, GRID, AXIS, tooltipStyle } from "@/lib/chartColors";
import TrendValue, { fmtSignedPct, trendTextClass } from "@/components/TrendValue";
import { useIsMobile } from "@/lib/useIsMobile";
import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

// ── Serialized data shapes (plain objects — no Map crosses the boundary) ────
export interface CompareCityRow {
  city_name: string;
  population_2026: number | null;
  households_2022: number | null;
  price_per_sqm_2026: number | null;
}

export interface CompareMetrics {
  cityName: string;
  chg1y: number | null;
  chg3y: number | null;
  newPremiumPct: number | null;
  newPremiumYear: number | null;
  dealsPerYear: number | null;
  gapPctOfDemand: number | null;
  gapSource: string;
  nDeals: number;
  distinctYears: number;
  confidence: "high" | "medium" | "low";
}

export interface CompareSeriesPoint {
  year: number;
  avg_sqm: number;
}

interface CompareViewProps {
  cities: CompareCityRow[];
  metrics: Record<string, CompareMetrics>;
  series: Record<string, CompareSeriesPoint[]>;
  initialCities: string[];
  refYear: number;
  provenance: string;
}

const MAX_CITIES = 4;

// ── Small formatters ────────────────────────────────────────────────────────
const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("he-IL");

/** signed number WITHOUT a % — for percentage-point (pp) values */
const fmtSignedPp = (v: number) => {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}`;
};

const CONFIDENCE_HE: Record<CompareMetrics["confidence"], string> = {
  high: "גבוהה",
  medium: "בינונית",
  low: "נמוכה",
};

// Confidence chips stay inside the indigo/slate system (not good/bad colors).
const CONFIDENCE_CHIP: Record<CompareMetrics["confidence"], string> = {
  high: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  medium: "bg-slate-100 text-slate-600 border border-slate-200",
  low: "bg-slate-50 text-slate-400 border border-slate-200",
};

// ── City slot: searchable combobox + remove ─────────────────────────────────
function CitySlot({
  value,
  color,
  cityList,
  taken,
  canRemove,
  autoFocus,
  onSelect,
  onRemove,
}: {
  value: string; // "" = empty slot still being chosen
  color: string;
  cityList: CompareCityRow[];
  taken: Set<string>;
  canRemove: boolean;
  autoFocus?: boolean;
  onSelect: (name: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // filter: while the text still equals the chosen city, show the top list
  const q = text.trim() === value.trim() ? "" : text.trim();
  const options = cityList
    .filter((c) => !taken.has(c.city_name) && (q === "" || c.city_name.includes(q)))
    .slice(0, 8);

  const commit = (name: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setText(name);
    setOpen(false);
    onSelect(name);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-colors">
        <span
          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <input
          type="text"
          dir="rtl"
          value={text}
          autoFocus={autoFocus}
          placeholder="חפש עיר..."
          className="w-full min-w-0 bg-transparent text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText(value);
              setOpen(false);
              if (value === "") onRemove();
            }
            if (e.key === "Enter" && options.length > 0) commit(options[0].city_name);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {
              setOpen(false);
              setText(value);
              if (value === "") onRemove(); // abandoned empty slot
            }, 150);
          }}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={value ? `הסר את ${value}` : "בטל הוספה"}
            className="flex-shrink-0 h-6 w-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-sm leading-none transition-colors"
          >
            <Icon name="close" size="1em" />
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <ul className="absolute z-[100] mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10">
          {options.map((c) => (
            <li key={c.city_name}>
              <button
                type="button"
                // mousedown fires before the input's blur → selection wins
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c.city_name);
                }}
                className="w-full flex items-baseline justify-between gap-2 px-3 py-2 text-right text-sm text-slate-800 hover:bg-indigo-50 transition-colors"
              >
                <span className="font-semibold">{c.city_name}</span>
                <span className="text-2xs text-slate-400 tabular-nums" dir="ltr">
                  {c.population_2026 != null ? c.population_2026.toLocaleString("he-IL") : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────
export default function CompareView({
  cities,
  metrics,
  series,
  initialCities,
  refYear,
  provenance,
}: CompareViewProps) {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const [selected, setSelected] = useState<string[]>(initialCities);
  const [adding, setAdding] = useState(false);

  const cityRowMap = useMemo(
    () => new Map(cities.map((c) => [c.city_name, c])),
    [cities]
  );

  function applySelection(next: string[]) {
    setSelected(next);
    // Shallow URL update — shareable link without re-running the server fetch.
    //
    // withBasePath is REQUIRED here and is the least obvious of the basePath
    // fixes. usePathname() returns the path with the base path already
    // stripped, so under basePath="/analist" this reads "/compare", and writing
    // that straight into replaceState would silently rewrite the address bar
    // from /analist/compare to /compare. Nothing breaks on the spot — the page
    // is already rendered — but every link the user then copies, bookmarks or
    // shares is wrong, and a refresh 404s.
    if (typeof window !== "undefined") {
      const qs = next.map((n) => encodeURIComponent(n)).join(",");
      const base = withBasePath(pathname);
      window.history.replaceState(null, "", qs ? `${base}?cities=${qs}` : base);
    }

    // Which cities people compare against each other, recorded here rather than
    // in the three call sites below so add/replace/remove are all covered by one
    // line. The initial selection arrives from the server and never passes
    // through this function, so what is logged is a deliberate change only.
    track("compare_select", { subject: next.join(","), detail: String(next.length) });
  }

  const replaceAt = (i: number, name: string) =>
    applySelection(selected.map((c, j) => (j === i ? name : c)));
  const removeAt = (i: number) =>
    applySelection(selected.filter((_, j) => j !== i));
  const appendCity = (name: string) => {
    setAdding(false);
    if (selected.length < MAX_CITIES && !selected.includes(name)) {
      applySelection([...selected, name]);
    }
  };

  // ── Chart data: union of years → one row per year, one key per city ──────
  const chartData = useMemo(() => {
    const years = new Set<number>();
    for (const c of selected) for (const p of series[c] ?? []) years.add(p.year);
    return [...years]
      .sort((a, b) => a - b)
      .map((year) => {
        const row: Record<string, number | null> = { year };
        for (const c of selected) {
          row[c] = (series[c] ?? []).find((p) => p.year === year)?.avg_sqm ?? null;
        }
        return row;
      });
  }, [selected, series]);

  // ── KPI table rows ───────────────────────────────────────────────────────
  type Row = {
    key: string;
    label: string;
    sub?: string;
    value: (city: string) => number | null; // numeric value used for "best" ranking
    render: (city: string) => ReactNode;
    best?: "max" | "min"; // undefined → no highlight (ambiguous meaning)
  };

  const m = (city: string): CompareMetrics | undefined => metrics[city];

  const rows: Row[] = [
    {
      key: "price",
      label: 'מחיר למ"ר 2026',
      sub: 'ממוצע עירוני, ₪ למ"ר',
      value: (c) => cityRowMap.get(c)?.price_per_sqm_2026 ?? null,
      render: (c) => {
        const v = cityRowMap.get(c)?.price_per_sqm_2026;
        return v == null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span dir="ltr" className="font-bold text-slate-900 tabular-nums">
            ₪{v.toLocaleString("he-IL")}
          </span>
        );
      },
      best: "min",
    },
    {
      key: "chg1y",
      label: `שינוי שנתי (${refYear - 1}→${refYear})`,
      sub: 'ממוצע ₪/מ"ר, כל העסקאות',
      value: (c) => m(c)?.chg1y ?? null,
      render: (c) => <TrendValue pct={m(c)?.chg1y} />,
      best: "max",
    },
    {
      key: "chg3y",
      label: `שינוי 3 שנים (${refYear - 3}→${refYear})`,
      sub: 'ממוצע ₪/מ"ר, כל העסקאות',
      value: (c) => m(c)?.chg3y ?? null,
      render: (c) => <TrendValue pct={m(c)?.chg3y} />,
      best: "max",
    },
    {
      key: "premium",
      label: "פרמיית חדשות",
      sub: "חדש מול יד שנייה, ₪/מ״ר (שנה מוצגת בתא)",
      value: (c) => m(c)?.newPremiumPct ?? null,
      render: (c) => {
        const mm = m(c);
        if (mm?.newPremiumPct == null) return <span dir="ltr" className="text-slate-300 tabular-nums">—</span>;
        return (
          <span dir="ltr" className="font-semibold text-slate-900 tabular-nums">
            {fmtSignedPct(mm.newPremiumPct)}
            {mm.newPremiumYear != null && (
              <span className="text-2xs font-normal text-slate-400"> ({mm.newPremiumYear})</span>
            )}
          </span>
        );
      },
      best: "min", // lower premium = cheaper entry to new-build
    },
    {
      key: "gap",
      label: "פער היצע (% מהביקוש)",
      sub: "חיובי = מחסור בדירות; שלילי = עודף",
      value: (c) => m(c)?.gapPctOfDemand ?? null,
      render: (c) => {
        const v = m(c)?.gapPctOfDemand;
        return v == null ? (
          <span dir="ltr" className="text-slate-300 tabular-nums">—</span>
        ) : (
          <span dir="ltr" className="font-semibold text-slate-900 tabular-nums">{fmtSignedPct(v)}</span>
        );
      },
      // no "best": shortage is upside for a landlord, downside for a buyer
    },
    {
      key: "dealsPerYear",
      label: `עסקאות בשנה (ממוצע ${refYear - 1}–${refYear})`,
      sub: "כל העסקאות במאגר הפנימי",
      value: (c) => m(c)?.dealsPerYear ?? null,
      render: (c) => <span className="tabular-nums text-slate-700">{fmtInt(m(c)?.dealsPerYear)}</span>,
      // no highlight: absolute count mostly reflects city size (see liquidity)
    },
    {
      key: "depth",
      label: "עומק דאטה",
      sub: "עסקאות שנאספו + שנים מכוסות",
      value: () => null,
      render: (c) => {
        const mm = m(c);
        if (!mm) return <span className="text-slate-300">—</span>;
        return (
          <span className="tabular-nums text-slate-700">
            {mm.nDeals.toLocaleString("he-IL")}
            <span className="text-2xs text-slate-400"> · {mm.distinctYears} שנים</span>
          </span>
        );
      },
    },
    {
      key: "confidence",
      label: "אמינות הנתונים",
      value: () => null,
      render: (c) => {
        const mm = m(c);
        if (!mm) return <span className="text-slate-300">—</span>;
        return (
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-2xs font-bold ${CONFIDENCE_CHIP[mm.confidence]}`}>
            {CONFIDENCE_HE[mm.confidence]}
          </span>
        );
      },
    },
  ];

  /** index of the winning city for a row — only when ≥2 comparable values */
  function bestIndex(row: Row): number | null {
    if (!row.best) return null;
    const vals = selected.map((c) => row.value(c));
    const present = vals.filter((v): v is number => v != null);
    if (present.length < 2) return null;
    const target = row.best === "max" ? Math.max(...present) : Math.min(...present);
    return vals.findIndex((v) => v === target);
  }

  const showAddSlot = adding && selected.length < MAX_CITIES;

  return (
    <div className="space-y-6">
      {/* ── City pickers ────────────────────────────────────────────────── */}
      <section className="glass-card p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {selected.map((city, i) => (
            <CitySlot
              key={`${city}-${i}`}
              value={city}
              color={SERIES[i % SERIES.length]}
              cityList={cities}
              taken={new Set(selected.filter((c) => c !== city))}
              canRemove={selected.length > 1}
              onSelect={(name) => replaceAt(i, name)}
              onRemove={() => removeAt(i)}
            />
          ))}

          {showAddSlot && (
            <CitySlot
              key="new-slot"
              value=""
              color={SERIES[selected.length % SERIES.length]}
              cityList={cities}
              taken={new Set(selected)}
              canRemove
              autoFocus
              onSelect={appendCity}
              onRemove={() => setAdding(false)}
            />
          )}

          {!showAddSlot && selected.length < MAX_CITIES && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors"
            >
              <span className="text-base leading-none" aria-hidden>+</span>
              הוסף עיר
            </button>
          )}
        </div>
        <p className="mt-3 text-2xs text-slate-400">
          עד {MAX_CITIES} ערים בהשוואה · הקישור בכתובת הדפדפן ניתן לשיתוף
        </p>
      </section>

      {/* ── Section 1: price overlay chart ──────────────────────────────── */}
      <section className="section-container">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="trend-up" size="1em" /></div>
          <div>
            <h2>מחיר ממוצע למ&quot;ר לאורך זמן</h2>
            <p>
              ממוצע ₪/מ&quot;ר בכל העסקאות (חדשות + יד שנייה) · 2010–{refYear + 1} · שנים עם
              פחות מ-30 עסקאות הושמטו
            </p>
          </div>
        </div>

        {selected.length === 0 || chartData.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-slate-500">
            אין נתוני מחירים לערים שנבחרו
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={mobile ? 280 : 340}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fill: AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={mobile ? 40 : 58}
                tickFormatter={(v: number) => `₪${Math.round(v / 1000)}K`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(year) => `שנת ${year}`}
                formatter={(value, name) => [
                  value == null || Number.isNaN(Number(value))
                    ? "—"
                    : `₪${Number(value).toLocaleString("he-IL", { maximumFractionDigits: 0 })} למ"ר`,
                  String(name ?? ""),
                ]}
              />
              <Legend verticalAlign="top" height={mobile ? undefined : 32} wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
              {selected.map((city, i) => (
                <Line isAnimationActive={false}
                  key={city}
                  type="monotone"
                  dataKey={city}
                  name={city}
                  stroke={SERIES[i % SERIES.length]}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Section 2: KPI comparison table ─────────────────────────────── */}
      <section className="section-container">
        <div className="section-header">
          <div className="section-header-icon"><Icon name="chart" size="1em" /></div>
          <div>
            <h2>מדדי משקיע — השוואה</h2>
            <p>רקע כחלחל מסמן את הערך הטוב ביותר בשורה · &quot;—&quot; = אין מספיק נתונים</p>
          </div>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[560px] text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky start-0 z-10 bg-white py-2.5 pe-2 text-right text-2xs font-bold text-slate-400 border-b border-slate-200 w-36 md:w-56">
                  מדד
                </th>
                {selected.map((city, i) => (
                  <th
                    key={city}
                    className="py-2.5 px-3 text-center border-b border-slate-200"
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: SERIES[i % SERIES.length] }}
                        aria-hidden
                      />
                      {city}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const winner = bestIndex(row);
                return (
                  <tr key={row.key} className="group">
                    <td className="sticky start-0 z-[1] bg-white py-2.5 pe-2 text-right align-top border-b border-slate-100">
                      <div className="text-xs font-bold text-slate-700 leading-tight">{row.label}</div>
                      {row.sub && (
                        <div className="text-2xs text-slate-400 mt-0.5 leading-tight">{row.sub}</div>
                      )}
                    </td>
                    {selected.map((city, i) => (
                      <td
                        key={city}
                        className={`py-2.5 px-3 text-center align-middle border-b border-slate-100 ${
                          winner === i ? "bg-indigo-50" : ""
                        }`}
                      >
                        {row.render(city)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-2xs text-slate-500">
          <span className="opacity-60" aria-hidden><Icon name="attachment" size="1em" /> </span>
          {provenance}
        </p>
      </section>
    </div>
  );
}
