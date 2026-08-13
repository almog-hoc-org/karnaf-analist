import NumberCaption from "./NumberCaption";
import {
  getCbsTransactionsForCity,
  CBS_TRANSACTIONS_SOURCE,
} from "@/lib/cbs-transactions-by-city";
import Icon from "@/components/Icon";

const YEAR = CBS_TRANSACTIONS_SOURCE.dataYear;

/**
 * Per-city panel showing the official CBS split between
 *   • new (contractor) apartment sales
 *   • second-hand (yad shniya) apartment sales
 * for 2025, with YoY 2024 + 2023 deltas.
 *
 * Data: hard-coded from CBS 047/2026 (table B, pages 6-7).
 * Coverage: 39 cities (cities with ≥500 transactions in either category).
 * Cities outside that list render an "אין נתון מאומת" notice.
 *
 * Also accepts a Yad2 listings-count as an optional 3rd indicator: the count
 * of OPEN listings on Yad2 (supply), to complement CBS's transaction (demand)
 * figure. The two are different things — we label them clearly.
 */
export default function NewVsSecondhandPanel({
  cityName,
  yad2SecondhandListings,
  yad2SecondhandYoy,
}: {
  cityName: string;
  yad2SecondhandListings?: number | null;
  yad2SecondhandYoy?: number | null;
}) {
  const cbs = getCbsTransactionsForCity(cityName);

  if (!cbs && yad2SecondhandListings === undefined) return null;

  return (
    <section className="glass-card p-5 mb-6">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 text-xl flex items-center justify-center flex-shrink-0">
          <Icon name="handshake" size="1em" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">
            עסקאות {YEAR} — חדשות מול יד שנייה
          </h3>
          <p className="text-2xs text-slate-500 mt-0.5">
            פילוח רשמי — למ״ס {CBS_TRANSACTIONS_SOURCE.publicationNumber}
          </p>
        </div>
      </div>

      {cbs ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* NEW apartments */}
          <SideCard
            title="דירות חדשות (קבלן)"
            tone="amber"
            value={cbs.new_sales_2025}
            yoy24={cbs.new_yoy_2024}
            yoy23={cbs.new_yoy_2023}
            cityName={cityName}
          />
          {/* SECOND-HAND apartments */}
          <SideCard
            title="דירות יד שנייה"
            tone="purple"
            value={cbs.secondhand_sales_2025}
            yoy24={cbs.secondhand_yoy_2024}
            yoy23={cbs.secondhand_yoy_2023}
            cityName={cityName}
          />
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
          <Icon name="warning" size="1em" /> <strong>{cityName}</strong> לא מופיעה בלוח ב של CBS 047/2026 (סף ≥500 עסקאות).{" "}
          הנתון העירוני לעיר זו לא פורסם במאומת — ניתן לראות אומדן כללי בפאנל מחיר חציוני למעלה.
        </div>
      )}

      {/* Yad2 supply context — different metric, labelled clearly */}
      {yad2SecondhandListings !== undefined && yad2SecondhandListings !== null && (
        <div className="mt-3 rounded-xl bg-indigo-50/40 border border-indigo-100 p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-lg"><Icon name="clipboard" size="1em" /></span>
              <div>
                <div className="text-2xs font-bold text-indigo-700 uppercase tracking-wide">
                  Yad2 — מודעות יד שנייה פתוחות (היצע)
                </div>
                <div className="text-sm text-slate-600 mt-0.5 leading-tight">
                  מספר המודעות שהיו פעילות באתר. שונה מספירת העסקאות בפועל — זהו{" "}
                  <strong>היצע</strong>, לא ביקוש.
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black tabular-nums text-slate-900">
                {yad2SecondhandListings.toLocaleString("he-IL")}
              </div>
              {yad2SecondhandYoy !== undefined && yad2SecondhandYoy !== null && (
                <div
                  className={`text-xs font-bold tabular-nums ${
                    yad2SecondhandYoy >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {yad2SecondhandYoy >= 0 ? "▲" : "▼"} {yad2SecondhandYoy.toFixed(1)}% YoY
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <NumberCaption
        source={`למ"ס ${CBS_TRANSACTIONS_SOURCE.publicationNumber}`}
        sourceHref={CBS_TRANSACTIONS_SOURCE.pdfUrl}
        period={`שנת ${YEAR} קלנדרית`}
        method="לוח ב — יישובים עם ≥500 עסקאות"
        updated={CBS_TRANSACTIONS_SOURCE.publishedDate.split("-").reverse().join(".").slice(0, 8)}
      />
    </section>
  );
}

function SideCard({
  title,
  tone,
  value,
  yoy24,
  yoy23,
  cityName,
}: {
  title: string;
  tone: "amber" | "purple";
  value: number | null;
  yoy24: number | null;
  yoy23: number | null;
  cityName: string;
}) {
  // Unified palette: brand-indigo tint for new (contractor), neutral slate for second-hand.
  const accent =
    tone === "amber"
      ? "bg-indigo-50/40 border-indigo-100"
      : "bg-slate-50/60 border-slate-200";
  const accentText = "text-slate-900";

  if (value === null) {
    return (
      <div className={`rounded-xl ${accent} border p-4 text-center opacity-50`}>
        <div className="text-2xs font-bold text-slate-500">{title}</div>
        <div className="text-3xl font-black text-slate-400 mt-1">—</div>
        <div className="text-2xs text-slate-500 mt-1 leading-tight">
          {cityName} מתחת לסף 500 עסקאות ({YEAR})
        </div>
      </div>
    );
  }

  // Numbers CENTERED and DOMINANT (operator spec 8/2026): this panel is a
  // number-first rubric, especially on a phone — the copy shrinks, the
  // figures grow.
  return (
    <div className={`rounded-xl ${accent} border p-4 text-center`}>
      <div className="text-2xs font-bold text-slate-500">{title}</div>
      <div className={`text-4xl font-black tabular-nums mt-1.5 ${accentText}`} style={{ lineHeight: 1.1 }}>
        {value.toLocaleString("he-IL")}
      </div>
      <div className="text-2xs text-slate-400 mt-1">עסקאות ב-{YEAR}</div>

      {(yoy24 !== null || yoy23 !== null) && (
        <div className="mt-3 pt-3 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-2xs">
          {yoy24 !== null && (
            <div className="text-center">
              <div className="text-slate-500">מול {YEAR - 1}</div>
              <div
                className={`font-bold tabular-nums ${
                  yoy24 >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {yoy24 >= 0 ? "▲ +" : "▼ "}
                {yoy24.toFixed(1)}%
              </div>
            </div>
          )}
          {yoy23 !== null && (
            <div className="text-center">
              <div className="text-slate-500">מול {YEAR - 2}</div>
              <div
                className={`font-bold tabular-nums ${
                  yoy23 >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {yoy23 >= 0 ? "▲ +" : "▼ "}
                {yoy23.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
