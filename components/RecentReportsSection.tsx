"use client";

import { useState } from "react";
import Link from "next/link";
import {
  RECENT_REPORTS,
  OTHER_RECENT_REPORTS,
  type FocusedReport,
  type ReportKpi,
  type DistrictKpi,
  type CityDataRow,
  type Tone,
} from "@/lib/recent-reports";
import { withBasePath } from "@/lib/basePath";

// ═══════════════════════════════════════════════════════════════════════════
//  Design system — TWO tones only: primary (indigo) + neutral (slate).
//  Legacy Tone keys from lib/recent-reports all collapse onto them.
//  Green/red appear ONLY as trend semantics (YoyChip / signed values).
// ═══════════════════════════════════════════════════════════════════════════

interface ToneStyle {
  text: string;
  bg: string;
  border: string;
  grad: string;
  dot: string;
  ring: string;
}

const PRIMARY_TONE: ToneStyle = {
  text: "text-indigo-700",
  bg: "bg-indigo-50",
  border: "border-indigo-200",
  grad: "from-indigo-600 to-indigo-500",
  dot: "bg-indigo-600",
  ring: "ring-indigo-600/30",
};

const NEUTRAL_TONE: ToneStyle = {
  text: "text-slate-700",
  bg: "bg-slate-100",
  border: "border-slate-200",
  grad: "from-slate-600 to-slate-500",
  dot: "bg-slate-600",
  ring: "ring-slate-600/30",
};

const TONE: Record<Tone, ToneStyle> = {
  blue: PRIMARY_TONE,
  emerald: PRIMARY_TONE,
  red: PRIMARY_TONE,
  amber: PRIMARY_TONE,
  purple: PRIMARY_TONE,
  slate: NEUTRAL_TONE,
};

const PUBLISHER = {
  CBS:   { he: 'למ"ס', cls: "bg-indigo-600 text-white" },
  MoF:   { he: "אוצר", cls: "bg-slate-700 text-white" },
  PRESS: { he: "עיתון", cls: "bg-slate-700 text-white" },
} as const;

/** Trend colour derived from the value's own sign — the ONLY green/red source
 *  for KPI values (the decorative `tone` field no longer drives colour). */
function valueTrendClass(value: string): string {
  if (/^[+▲]/.test(value)) return "text-emerald-700";
  if (/^[-−▼]/.test(value)) return "text-red-600";
  return "text-slate-900";
}

// ═══════════════════════════════════════════════════════════════════════════
//  Visual primitives — small, focused
// ═══════════════════════════════════════════════════════════════════════════

function YoyChip({ value }: { value?: number }) {
  if (value === undefined || value === null) return null;
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded text-2xs font-bold tabular-nums ${positive ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100"}`}>
      <span className="text-2xs">{positive ? "▲" : "▼"}</span>
      <span>{Math.abs(value).toFixed(1)}%</span>
    </span>
  );
}

function KpiPill({ kpi }: { kpi: ReportKpi }) {
  return (
    <div className="rounded-xl px-3 py-2.5 bg-white border border-slate-200 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="mb-1 flex items-start justify-between gap-1">
        <span className="min-w-0 break-words text-2xs font-semibold leading-tight tracking-tight text-slate-500">{kpi.label}</span>
        {kpi.yoy !== undefined && <YoyChip value={kpi.yoy} />}
      </div>
      <div className={`text-base font-bold tabular-nums leading-none ${valueTrendClass(kpi.value)}`}>{kpi.value}</div>
      {kpi.hint && <div className="mt-1 break-words text-2xs leading-snug text-slate-500">{kpi.hint}</div>}
    </div>
  );
}

function DistrictHeatmap({ districts }: { districts: DistrictKpi[] }) {
  const hasMom = districts.some((d) => d.momPct !== undefined);
  const max = Math.max(...districts.map((d) => Math.abs(d.yoyPct)), 1);

  // Two-window legend
  return (
    <div>
      {/* Legend explaining what the colours mean */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-2xs text-slate-500">
        <span className="font-bold text-slate-700">המספרים:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-slate-400" />
          <strong>YoY</strong> = שנתי (מול שנה קודמת)
        </span>
        {hasMom && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-slate-300" />
            <strong>MoM</strong> = דו-חודשי (מול תקופה קודמת)
          </span>
        )}
      </div>
      {/* 2→3 columns: 6 squeezed each district to ~90px and clipped names */}
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
        {districts.map((d) => {
          const intensity = Math.abs(d.yoyPct) / max;
          const positive = d.yoyPct >= 0;
          // Background tint follows the YoY signal (it's the primary metric)
          const bg = positive
            ? `rgba(16, 185, 129, ${0.10 + intensity * 0.40})`
            : `rgba(220, 38, 38, ${0.10 + intensity * 0.40})`;
          const momPositive = (d.momPct ?? 0) >= 0;
          return (
            <div
              key={d.district}
              className="rounded-lg px-2 py-2 border border-slate-200/70"
              style={{ backgroundColor: bg }}
            >
              <div className="break-words text-2xs font-bold leading-tight text-slate-800">{d.district}</div>

              {/* YoY — the primary big number */}
              <div className={`flex items-baseline gap-1 mt-0.5 ${positive ? "text-emerald-900" : "text-red-900"}`}>
                <span className="text-base font-extrabold tabular-nums leading-tight">
                  {d.yoyPct >= 0 ? "+" : ""}{d.yoyPct.toFixed(1)}%
                </span>
                <span className="text-2xs font-bold opacity-70">YoY</span>
              </div>

              {/* MoM — secondary, smaller, separately coloured */}
              {d.momPct !== undefined && (
                <div className={`flex items-baseline gap-1 mt-1 pt-1 border-t border-white/40 ${momPositive ? "text-emerald-800/80" : "text-red-800/80"}`}>
                  <span className="text-2xs font-bold tabular-nums leading-none">
                    {d.momPct >= 0 ? "+" : ""}{d.momPct.toFixed(1)}%
                  </span>
                  <span className="text-2xs font-semibold opacity-70">MoM</span>
                </div>
              )}

              {d.context && <div className="mt-1 break-words text-2xs leading-snug text-slate-700/80">{d.context}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CityRow({ row, max, metric }: { row: CityDataRow; max: number; metric: "starts" | "price" | "sales" }) {
  const val = metric === "starts" ? row.starts : metric === "sales" ? row.sold : row.avgPrice;
  if (!val) return null;
  const pct = (val / max) * 100;
  const display = metric === "price" ? `₪${(val / 1_000_000).toFixed(2)}M` : val.toLocaleString("he-IL");
  return (
    <div className="relative px-3 py-1.5 group hover:bg-slate-50/80 transition-colors">
      <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-indigo-100/60 to-indigo-50/0" style={{ width: `${pct}%` }} aria-hidden />
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Link href={`/city/${encodeURIComponent(row.city)}`} className="min-w-0 flex-1 basis-24 break-words font-semibold leading-tight text-slate-900 hover:text-indigo-700 hover:underline">
          {row.city}
        </Link>
        {row.rankNote && (
          <span className="text-2xs px-1.5 py-px rounded bg-white/80 border border-slate-200 text-slate-600 font-semibold whitespace-nowrap">{row.rankNote}</span>
        )}
        {row.yoy !== undefined && <YoyChip value={row.yoy} />}
        <span className="tabular-nums font-bold text-slate-800 whitespace-nowrap">{display}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Detail panel — full content of the active report
// ═══════════════════════════════════════════════════════════════════════════

function ReportDetail({ report }: { report: FocusedReport }) {
  const t = TONE[report.accent];
  const [activeView, setActiveView] = useState<"summary" | "districts" | "cities" | "context">("summary");

  const hasDistricts = !!report.districtKpis?.length;
  const hasCities = !!report.cityTable?.length;

  const tabs = [
    { id: "summary" as const, label: "📊 מטריקות עיקריות" },
    ...(hasDistricts ? [{ id: "districts" as const, label: "🗺️ פירוט מחוז" }] : []),
    ...(hasCities ? [{ id: "cities" as const, label: "🏙️ פירוט עיר" }] : []),
    { id: "context" as const, label: "🔗 קישור למאגר" },
  ];

  const max = hasCities && report.cityTable
    ? Math.max(
        ...report.cityTable.map((r) => {
          const v = report.cityTableMetric === "starts" ? r.starts
                  : report.cityTableMetric === "sales"  ? r.sold
                  :                                       r.avgPrice;
          return v ?? 0;
        }),
        1
      )
    : 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.3fr,1fr] gap-6 items-start">
      {/* ── Left column: Hero stat + headline ── */}
      <div className="space-y-4">
        {/* Big hero stat */}
        <div className={`rounded-2xl p-5 bg-gradient-to-br ${t.bg} border ${t.border}`}>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className={`font-black tracking-tight ${t.text} tabular-nums leading-none`} style={{ fontSize: "clamp(30px, 8vw, 44px)" }}>
              {report.bigStat.value}
            </div>
            <div className="min-w-0 flex-1 basis-40 pb-1.5">
              <div className="break-words text-sm font-bold leading-tight text-slate-900">{report.bigStat.label}</div>
              {report.bigStat.subhint && (
                <div className="mt-1 break-words text-2xs leading-snug text-slate-600">{report.bigStat.subhint}</div>
              )}
            </div>
          </div>
        </div>

        {/* Headline narrative */}
        <p className="text-xs text-slate-700 leading-relaxed">{report.headline}</p>

        {/* Footer with source links */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-2xs">
          <a href={report.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${t.text} hover:underline font-bold inline-flex items-center gap-1`}>
            📄 הדוח המקורי באתר הלמ&quot;ס ↗
          </a>
          {report.primaryPdfPath && (
            <a href={withBasePath(report.primaryPdfPath)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-2xs font-bold">
              ✓ עותק מקומי
            </a>
          )}
          <Link href={`/sources/${report.sourcePageId}`} className="text-slate-500 hover:text-indigo-700 font-semibold mr-auto">
            כל הפרסומים בסדרה →
          </Link>
        </div>
      </div>

      {/* ── Right column: Tabbed details ── */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab strip */}
        <div className="flex border-b border-slate-200 bg-slate-50/60 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={`px-3 py-2 text-2xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                activeView === tab.id
                  ? `${t.text} border-current bg-white`
                  : "text-slate-500 border-transparent hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4">
          {activeView === "summary" && (
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 gap-2">
              {report.kpis.map((k, i) => <KpiPill key={i} kpi={k} />)}
            </div>
          )}

          {activeView === "districts" && report.districtKpis && (
            <DistrictHeatmap districts={report.districtKpis} />
          )}

          {activeView === "cities" && report.cityTable && (
            <div>
              {report.cityTableLabel && (
                <div className="text-2xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                  {report.cityTableLabel}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-hidden max-h-[280px] overflow-y-auto divide-y divide-slate-100">
                {report.cityTable.map((row, i) => (
                  <CityRow key={i} row={row} max={max} metric={report.cityTableMetric ?? "starts"} />
                ))}
              </div>
            </div>
          )}

          {activeView === "context" && (
            <div className="space-y-3">
              <div className="rounded-xl bg-indigo-50/60 border border-indigo-200 p-3">
                <div className="text-2xs font-bold text-indigo-700 uppercase tracking-wide mb-2">
                  {report.dbCrossReference.title}
                </div>
                <ul className="space-y-1.5 text-2xs text-slate-700 list-disc pr-5 leading-relaxed">
                  {report.dbCrossReference.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
              {report.contextualNote && (
                <p className="text-2xs text-slate-500 italic leading-relaxed">💬 {report.contextualNote}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab strip — sits at top, switches the detail view
// ═══════════════════════════════════════════════════════════════════════════

function TabHeadline({ report, active, onClick }: { report: FocusedReport; active: boolean; onClick: () => void }) {
  const t = TONE[report.accent];
  const pub = PUBLISHER[report.publisher];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-right rounded-2xl border transition-all overflow-hidden ${
        active
          ? `bg-white shadow-lg ring-2 ${t.ring} border-transparent`
          : "bg-white/60 border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      {/* Top accent bar */}
      <div className={`h-1 bg-gradient-to-l ${t.grad} ${active ? "opacity-100" : "opacity-30"}`} />
      <div className="p-4">
        {/* Header row: publisher + status + date */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className={`inline-block px-2 py-0.5 text-2xs font-bold rounded ${pub.cls}`}>{pub.he}</span>
          {report.publicationNumber && (
            <span className="text-2xs font-mono text-slate-500">{report.publicationNumber}</span>
          )}
          <span className="text-2xs text-slate-500 font-semibold mr-auto tabular-nums">{report.publishedDate}</span>
        </div>

        {/* Title */}
        <h3 className={`text-xs font-bold leading-tight transition-colors ${active ? "text-slate-900" : "text-slate-700 group-hover:text-slate-900"}`}>
          {report.title}
        </h3>
        <p className="mt-0.5 break-words text-2xs leading-snug text-slate-500">{report.coverWindow}</p>

        {/* Big stat inline */}
        <div className={`mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-slate-100 pt-3`}>
          <span className={`text-2xl font-black tabular-nums ${t.text} leading-none`}>{report.bigStat.value}</span>
          <span className="min-w-0 break-words text-2xs font-semibold leading-snug text-slate-600">{report.bigStat.label}</span>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main section
// ═══════════════════════════════════════════════════════════════════════════

/** A report the refresh engine discovered (data/recent_reports.json) —
 *  serialized by the server page via loadDiscoveredReports(). */
export interface DiscoveredReport {
  id: string;
  title: string;
  publisher: "CBS" | "MoF";
  publishedDate: string | null;
  pdfUrl: string;
  primaryPdfPath: string | null;
  highlights?: string[];
}

export default function RecentReportsSection({
  discovered = [],
  lastRefreshedAt = "",
}: {
  discovered?: DiscoveredReport[];
  lastRefreshedAt?: string;
} = {}) {
  const [activeId, setActiveId] = useState<string>(RECENT_REPORTS[0]?.id ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  const active = RECENT_REPORTS.find((r) => r.id === activeId) ?? RECENT_REPORTS[0];
  if (!active) return null; // no curated reports → render nothing instead of crashing

  return (
    <section className="mt-14 mb-12">
      {/* ── Section header — light, compact ── */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xs font-bold uppercase tracking-[0.2em] text-indigo-700">Primary-Source Reports</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-2xs font-bold">
              🏛️ מקור חיצוני: למ״ס
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
            דוחות עדכניים מהלמ&quot;ס
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-snug max-w-2xl">
            בחר דוח כדי לראות פירוט מאקרו, פירוט פר מחוז וטבלת ערים מלאה.
          </p>
        </div>
        <Link href="/sources" className="text-2xs text-indigo-700 hover:underline font-bold inline-flex items-center gap-1 mr-auto self-center">
          כל המקורות עם מטריצת כיסוי 10 שנים →
        </Link>
      </div>

      {/* ── Tab triggers (3-up on desktop, stacked on mobile) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5" role="tablist">
        {RECENT_REPORTS.map((r) => (
          <TabHeadline
            key={r.id}
            report={r}
            active={activeId === r.id}
            onClick={() => setActiveId(r.id)}
          />
        ))}
      </div>

      {/* ── Active detail panel ── */}
      <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 md:p-6">
        <ReportDetail report={active} />
      </div>

      {/* ── Reports discovered by the refresh engine (data/recent_reports.json) ── */}
      {discovered.length > 0 && (
        <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-black text-indigo-800">
              🔄 נמצאו ברענון האוטומטי
            </span>
            {lastRefreshedAt && (
              <span className="min-w-0 break-words text-2xs text-slate-500">
                סריקה אחרונה: {new Date(lastRefreshedAt).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} · למ״ס + אוצר · סינון לפי כותרת
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {discovered.map((r) => (
              <a
                key={r.id}
                href={r.primaryPdfPath ?? r.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-all hover:border-indigo-300 hover:shadow-md"
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={`inline-block rounded px-2 py-0.5 text-2xs font-bold ${PUBLISHER[r.publisher].cls}`}>
                    {PUBLISHER[r.publisher].he}
                  </span>
                  {r.publishedDate && (
                    <span className="text-2xs tabular-nums text-slate-500">📅 {r.publishedDate}</span>
                  )}
                  <span className="ms-auto text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">↗</span>
                </div>
                <p className="break-words text-xs font-bold leading-snug text-slate-900 transition-colors group-hover:text-indigo-700">
                  {r.title}
                </p>
                {r.highlights?.[0] && (
                  <p className="mt-0.5 break-words text-2xs leading-snug text-slate-600">{r.highlights[0]}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Other reports — collapsed by default ── */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setMoreOpen((x) => !x)}
          className="w-full text-right rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 px-4 py-3 flex items-center justify-between transition-colors group"
        >
          <span className="text-2xs text-slate-400 group-hover:text-slate-600">{moreOpen ? "סגור ▲" : "פתח ▼"}</span>
          <div className="flex items-center gap-2">
            <span className="text-base">📚</span>
            <span className="text-sm font-bold text-slate-700">דוחות נוספים בחלון 3-החודשים ({OTHER_RECENT_REPORTS.length})</span>
          </div>
        </button>

        {moreOpen && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {OTHER_RECENT_REPORTS.map((r, i) => (
              <a
                key={i}
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl bg-white border border-slate-200 px-3 py-2.5 hover:border-indigo-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-block px-2 py-0.5 text-2xs font-bold rounded ${PUBLISHER[r.publisher].cls}`}>
                    {PUBLISHER[r.publisher].he}
                  </span>
                  {r.publicationNumber && (
                    <span className="text-2xs font-mono text-slate-500 bg-slate-100 px-1.5 py-px rounded">
                      {r.publicationNumber}
                    </span>
                  )}
                  <span className="text-2xs text-slate-500 tabular-nums mr-auto">📅 {r.publishedDate}</span>
                  <span className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                </div>
                <p className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">
                  {r.title}
                </p>
                <p className="text-2xs text-slate-600 leading-snug mt-0.5">{r.summary}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
