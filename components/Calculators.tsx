"use client";

/**
 * Four self-contained financial calculators. Pure client-side arithmetic —
 * no data dependency, no server round-trips, zero risk to the data pipeline.
 *
 * Formulas:
 *   Mortgage (שפיצר): M = P·r·(1+r)^n / ((1+r)^n − 1), r = annual/12.
 *   Compound interest: FV = P·(1+r)^y + monthly·(((1+r_m)^(12y) − 1)/r_m).
 *   Rental yield: gross = 12·rent/price; net subtracts expenses and vacancy.
 *   Renovation: compares (price+cost) against post-renovation value and the
 *   rent uplift it buys.
 *
 * Every result carries the disclaimer — these are planning aids, not advice.
 */
import { useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";

const fmt = (v: number, digits = 0) =>
  Number.isFinite(v) ? v.toLocaleString("he-IL", { maximumFractionDigits: digits }) : "—";

/** signed ₪ display — "+₪800" / "−₪800"; never a double sign */
const fmtSignedNis = (v: number, digits = 0) =>
  Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}₪${fmt(Math.abs(v), digits)}` : "—";

/** Spitzer monthly payment. ONE definition — the two calculators using it had
 *  already drifted apart on the n<=0 guard. NaN = inputs don't form a loan. */
function monthlyPayment(loan: number, annualPct: number, years: number): number {
  if (loan <= 0) return 0;
  const n = years * 12;
  if (n <= 0) return NaN;
  const r = annualPct / 100 / 12;
  if (r === 0) return loan / n;
  return (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/* ── shared UI atoms ─────────────────────────────────────────────────────── */

function Field({ label, value, onChange, suffix, step = 1, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number; min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-indigo-400 focus:outline-none"
          dir="ltr"
        />
        {suffix && <span className="shrink-0 text-xs text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

function Result({ label, value, accent = false, sub }: { label: string; value: string; accent?: boolean; sub?: string }) {
  return (
    <div className={`rounded-2xl border p-4 text-center ${accent ? "border-indigo-200 bg-indigo-50/70" : "border-slate-200 bg-white"}`}>
      <p className="text-2xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${accent ? "text-indigo-700" : "text-slate-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-2xs text-slate-500">{sub}</p>}
    </div>
  );
}

/* ── 1 · mortgage — multi-track mix (תמהיל) ──────────────────────────────── */

type TrackType = "fixed" | "fixed_linked" | "prime" | "variable_linked";

const TRACK_TYPES: Record<TrackType, { label: string; linked: boolean; primeSensitive: boolean; note: string }> = {
  fixed:           { label: "קבועה לא צמודה",      linked: false, primeSensitive: false, note: "ההחזר קבוע לכל התקופה — הוודאות המלאה, בדרך כלל הריבית הגבוהה ביותר" },
  fixed_linked:    { label: "קבועה צמודת מדד",     linked: true,  primeSensitive: false, note: "הריבית קבועה אבל הקרן צמודה למדד — ההחזר מטפס עם האינפלציה" },
  prime:           { label: "פריים",                linked: false, primeSensitive: true,  note: "פריים = ריבית בנק ישראל + 1.5% — משתנה עם כל החלטת ריבית, לא צמודה למדד" },
  variable_linked: { label: "משתנה צמודה (כל 5)",  linked: true,  primeSensitive: false, note: "הריבית מתעדכנת כל 5 שנים וגם צמודה למדד" },
};

interface Track { id: number; type: TrackType; amount: number; rate: number; years: number }

/** the classic starting mix — thirds, at realistic 2026 market rates */
const DEFAULT_TRACKS: Track[] = [
  { id: 1, type: "fixed",        amount: 340_000, rate: 5.1,  years: 25 },
  { id: 2, type: "prime",        amount: 330_000, rate: 5.25, years: 25 },
  { id: 3, type: "fixed_linked", amount: 330_000, rate: 3.4,  years: 25 },
];

function MortgageCalc() {
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS);
  const [inflation, setInflation] = useState(2.5);
  const [propertyValue, setPropertyValue] = useState(0);
  const [netIncome, setNetIncome] = useState(0);
  const nextId = useRef(DEFAULT_TRACKS.length + 1);

  const patch = (id: number, p: Partial<Track>) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const remove = (id: number) => setTracks((ts) => ts.filter((t) => t.id !== id));
  const add = () =>
    setTracks((ts) => [...ts, { id: nextId.current++, type: "fixed", amount: 200_000, rate: 5.0, years: 20 }]);

  const calc = useMemo(() => {
    const rows = tracks.map((t) => {
      const meta = TRACK_TYPES[t.type];
      const initial = monthlyPayment(t.amount, t.rate, t.years);
      // CPI-linked tracks: linking compounds like extra interest, so the
      // AVERAGE payment over the life is approximated by rate+inflation.
      // Honest approximation for planning — the disclaimer says so.
      const estAvg = meta.linked ? monthlyPayment(t.amount, t.rate + inflation, t.years) : initial;
      const estTotal = estAvg * t.years * 12;
      const primeUp = meta.primeSensitive ? monthlyPayment(t.amount, t.rate + 1, t.years) : null;
      return { t, meta, initial, estAvg, estTotal, primeUp };
    });
    const principal = tracks.reduce((s, t) => s + t.amount, 0);
    const firstMonthly = rows.reduce((s, r) => s + (Number.isFinite(r.initial) ? r.initial : 0), 0);
    const estAvgMonthly = rows.reduce((s, r) => s + (Number.isFinite(r.estAvg) ? r.estAvg : 0), 0);
    const estTotal = rows.reduce((s, r) => s + (Number.isFinite(r.estTotal) ? r.estTotal : 0), 0);
    const primeUpDelta = rows.reduce((s, r) => s + (r.primeUp != null && Number.isFinite(r.primeUp) ? r.primeUp - r.initial : 0), 0);
    return { rows, principal, firstMonthly, estAvgMonthly, estTotal, primeUpDelta };
  }, [tracks, inflation]);

  const ltv = propertyValue > 0 ? (calc.principal / propertyValue) * 100 : null;
  const payRatio = netIncome > 0 ? (calc.firstMonthly / netIncome) * 100 : null;

  const inputCls = "w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-indigo-400 focus:outline-none";

  return (
    <div className="space-y-5">
      {/* track table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" dir="rtl">
          <thead className="text-2xs font-bold text-slate-400">
            <tr>
              <th className="py-1.5 pl-2 text-right">מסלול</th>
              <th className="text-right">סכום ₪</th>
              <th className="text-right">ריבית %</th>
              <th className="text-right">שנים</th>
              <th className="text-right">החזר ראשון</th>
              <th className="text-right">ממוצע משוער*</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {calc.rows.map(({ t, meta, initial, estAvg }) => (
              <tr key={t.id} className="border-t border-slate-100 align-top">
                <td className="py-2 pl-2">
                  <select value={t.type} onChange={(e) => patch(t.id, { type: e.target.value as TrackType })}
                    className="w-full rounded-lg border border-slate-200 px-1.5 py-1.5 text-xs font-semibold text-slate-700">
                    {Object.entries(TRACK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <p className="mt-1 max-w-[190px] text-[10px] leading-tight text-slate-400">{meta.note}</p>
                </td>
                <td className="py-2 pl-2"><input type="number" dir="ltr" step={10000} min={0} value={t.amount || ""} onChange={(e) => patch(t.id, { amount: Number(e.target.value) })} className={inputCls} /></td>
                <td className="py-2 pl-2"><input type="number" dir="ltr" step={0.05} min={0} value={t.rate || ""} onChange={(e) => patch(t.id, { rate: Number(e.target.value) })} className={inputCls} /></td>
                <td className="py-2 pl-2"><input type="number" dir="ltr" step={1} min={1} max={30} value={t.years || ""} onChange={(e) => patch(t.id, { years: Number(e.target.value) })} className={inputCls} /></td>
                <td className="py-2 pl-2 font-bold tabular-nums text-slate-900">₪{fmt(initial)}</td>
                <td className="py-2 pl-2 tabular-nums text-slate-600">₪{fmt(estAvg)}</td>
                <td className="py-2 text-left">
                  {tracks.length > 1 && (
                    <button onClick={() => remove(t.id)} aria-label="הסר מסלול"
                      className="rounded-lg px-2 py-1 text-xs font-bold text-slate-300 hover:bg-red-50 hover:text-red-500">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="rounded-xl border border-dashed border-indigo-300 px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
        + הוסף מסלול
      </button>

      {/* shared assumptions for all tracks */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="אינפלציה שנתית צפויה (למסלולים צמודים)" value={inflation} onChange={setInflation} suffix="%" step={0.1} />
        <Field label="שווי הנכס (לא חובה — לחישוב אחוז מימון)" value={propertyValue} onChange={setPropertyValue} suffix="₪" step={50000} />
        <Field label="הכנסה חודשית נטו (לא חובה — ליחס החזר)" value={netIncome} onChange={setNetIncome} suffix="₪" step={500} />
      </div>

      {/* summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Result label="סה״כ משכנתא" value={`₪${fmt(calc.principal)}`} />
        <Result label="החזר חודשי ראשון" value={`₪${fmt(calc.firstMonthly)}`} accent
          sub={payRatio != null ? `${fmt(payRatio, 1)}% מההכנסה${payRatio > 40 ? " ⚠️ מעל תקרת בנק ישראל (40%)" : ""}` : undefined} />
        <Result label="החזר ממוצע משוער*" value={`₪${fmt(calc.estAvgMonthly)}`}
          sub="כולל אומדן הצמדה למדד" />
        <Result label="סה״כ החזר משוער*" value={`₪${fmt(calc.estTotal)}`}
          sub={`מזה ריבית והצמדה ₪${fmt(calc.estTotal - calc.principal)}`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {ltv != null && (
          <Result label="אחוז מימון (LTV)" value={`${fmt(ltv, 1)}%`}
            sub={ltv > 75 ? "⚠️ מעל 75% — מעבר לתקרה לדירה יחידה" : ltv > 50 ? "טווח מקובל לדירה יחידה" : "מימון נמוך — עמדת מיקוח טובה"} />
        )}
        {calc.primeUpDelta > 0 && (
          <Result label="רגישות: פריים +1%" value={`+₪${fmt(calc.primeUpDelta)}/חודש`}
            sub="כמה יקפוץ ההחזר אם ריבית בנק ישראל תעלה באחוז" />
        )}
      </div>

      <p className="text-2xs leading-relaxed text-slate-400">
        * לוח שפיצר. במסלולים צמודי מדד ההחזר מטפס בהדרגה — &quot;הממוצע המשוער&quot; מקרב את עלות ההצמדה
        לפי האינפלציה שהזנת, וההחזר בפועל מתחיל נמוך יותר ומסיים גבוה יותר. מסלול פריים ומשתנות ישתנו עם
        השוק. זהו כלי תכנון להשוואת תמהילים — לא תחליף לייעוץ משכנתאות ולא הצעה בנקאית.
      </p>
    </div>
  );
}

/* ── 2 · compound interest ───────────────────────────────────────────────── */

function CompoundCalc() {
  const [principal, setPrincipal] = useState(100_000);
  const [monthly, setMonthly] = useState(2_000);
  const [rate, setRate] = useState(7);
  const [years, setYears] = useState(15);

  const { fv, invested } = useMemo(() => {
    const rm = rate / 100 / 12;
    const months = years * 12;
    const fvPrincipal = principal * Math.pow(1 + rm, months);
    const fvMonthly = rm === 0 ? monthly * months : monthly * ((Math.pow(1 + rm, months) - 1) / rm);
    return { fv: fvPrincipal + fvMonthly, invested: principal + monthly * months };
  }, [principal, monthly, rate, years]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="סכום התחלתי" value={principal} onChange={setPrincipal} suffix="₪" step={5000} />
        <Field label="הפקדה חודשית" value={monthly} onChange={setMonthly} suffix="₪" step={100} />
        <Field label="תשואה שנתית ממוצעת" value={rate} onChange={setRate} suffix="%" step={0.5} />
        <Field label="שנים" value={years} onChange={setYears} suffix="שנים" />
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2">
        <Result label="שווי עתידי" value={`₪${fmt(fv)}`} accent />
        <Result label="סה״כ הופקד" value={`₪${fmt(invested)}`} sub={`רווח ₪${fmt(fv - invested)}`} />
      </div>
      <p className="text-2xs leading-relaxed text-slate-400 lg:col-span-2">
        ריבית-דריבית בהפקדה חודשית קבועה, לפני מס ועמלות. תשואות עבר אינן ערובה לתשואות עתיד.
      </p>
    </div>
  );
}

/* ── 3 · rental investment ───────────────────────────────────────────────── */

function InvestmentCalc() {
  const [price, setPrice] = useState(1_500_000);
  const [rent, setRent] = useState(4_500);
  const [expenses, setExpenses] = useState(350);
  const [vacancyWeeks, setVacancyWeeks] = useState(2);
  const [equity, setEquity] = useState(750_000);
  const [mortgageRate, setMortgageRate] = useState(4.9);
  const [mortgageYears, setMortgageYears] = useState(20);

  const calc = useMemo(() => {
    const annualRent = rent * 12 * (1 - vacancyWeeks / 52) - expenses * 12;
    const grossYield = (rent * 12) / price * 100;
    const netYield = annualRent / price * 100;
    const pay = monthlyPayment(Math.max(0, price - equity), mortgageRate, mortgageYears);
    const cashflow = annualRent / 12 - pay;
    return { grossYield, netYield, pay, cashflow };
  }, [price, rent, expenses, vacancyWeeks, equity, mortgageRate, mortgageYears]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מחיר הדירה" value={price} onChange={setPrice} suffix="₪" step={50000} />
        <Field label="שכירות חודשית צפויה" value={rent} onChange={setRent} suffix="₪" step={100} />
        <Field label="הוצאות חודשיות (ועד, ביטוח, תחזוקה)" value={expenses} onChange={setExpenses} suffix="₪" step={50} />
        <Field label="שבועות ללא שוכר בשנה" value={vacancyWeeks} onChange={setVacancyWeeks} suffix="שבועות" />
        <Field label="הון עצמי" value={equity} onChange={setEquity} suffix="₪" step={50000} />
        <Field label="ריבית משכנתא" value={mortgageRate} onChange={setMortgageRate} suffix="%" step={0.1} />
        <Field label="שנות משכנתא" value={mortgageYears} onChange={setMortgageYears} suffix="שנים" />
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2">
        <Result label="תשואה ברוטו" value={`${fmt(calc.grossYield, 2)}%`} />
        <Result label="תשואה נטו" value={`${fmt(calc.netYield, 2)}%`} accent />
        <Result label="החזר משכנתא חודשי" value={`₪${fmt(calc.pay)}`} />
        <Result
          label="תזרים חודשי"
          value={fmtSignedNis(calc.cashflow)}
          sub={!Number.isFinite(calc.cashflow) ? undefined : calc.cashflow >= 0 ? "הנכס מכסה את עצמו" : "דורש השלמה מהכיס"}
        />
      </div>
      <p className="text-2xs leading-relaxed text-slate-400 lg:col-span-2">
        לא כולל מס רכישה, מס שבח, עליית ערך או שיפוצים. השווה את השכירות המבוקשת מול עסקאות אמת בעמוד העיר.
      </p>
    </div>
  );
}

/* ── 4 · renovation ROI ──────────────────────────────────────────────────── */

function RenovationCalc() {
  const [buyPrice, setBuyPrice] = useState(1_200_000);
  const [renoCost, setRenoCost] = useState(150_000);
  const [afterValue, setAfterValue] = useState(1_450_000);
  const [rentBefore, setRentBefore] = useState(3_800);
  const [rentAfter, setRentAfter] = useState(4_600);

  const calc = useMemo(() => {
    const totalIn = buyPrice + renoCost;
    const equityGain = afterValue - totalIn;
    const roi = renoCost > 0 ? (equityGain / renoCost) * 100 : NaN;
    const rentUplift = rentAfter - rentBefore;
    const paybackYears = rentUplift > 0 ? renoCost / (rentUplift * 12) : NaN;
    return { totalIn, equityGain, roi, rentUplift, paybackYears };
  }, [buyPrice, renoCost, afterValue, rentBefore, rentAfter]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מחיר קנייה" value={buyPrice} onChange={setBuyPrice} suffix="₪" step={50000} />
        <Field label="עלות שיפוץ" value={renoCost} onChange={setRenoCost} suffix="₪" step={10000} />
        <Field label="שווי אחרי שיפוץ (הערכה)" value={afterValue} onChange={setAfterValue} suffix="₪" step={50000} />
        <Field label="שכירות לפני" value={rentBefore} onChange={setRentBefore} suffix="₪" step={100} />
        <Field label="שכירות אחרי" value={rentAfter} onChange={setRentAfter} suffix="₪" step={100} />
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2">
        <Result label="סה״כ השקעה" value={`₪${fmt(calc.totalIn)}`} />
        <Result
          label="רווח הוני מהשיפוץ"
          value={fmtSignedNis(calc.equityGain)}
          accent
          sub={Number.isFinite(calc.roi) ? `תשואה על עלות השיפוץ: ${fmt(calc.roi)}%` : undefined}
        />
        <Result label="תוספת שכירות" value={`${fmtSignedNis(calc.rentUplift)}/חודש`} />
        <Result
          label="החזר השקעה משכירות"
          value={Number.isFinite(calc.paybackYears) ? `${fmt(calc.paybackYears, 1)} שנים` : "—"}
        />
      </div>
      <p className="text-2xs leading-relaxed text-slate-400 lg:col-span-2">
        &quot;שווי אחרי&quot; הוא ההנחה הקריטית — בסס אותה על עסקאות אמת של דירות משופצות באותו אזור (עמוד העיר → פירוט עסקאות).
      </p>
    </div>
  );
}

/* ── shell ───────────────────────────────────────────────────────────────── */

const TABS = [
  { key: "mortgage", label: "תמהיל משכנתא", icon: "institution", comp: MortgageCalc },
  { key: "investment", label: "כדאיות השקעה", icon: "money", comp: InvestmentCalc },
  { key: "renovation", label: "כדאיות שיפוץ", icon: "bricks", comp: RenovationCalc },
  { key: "compound", label: "ריבית דריבית", icon: "trend-up", comp: CompoundCalc },
] as const;

export default function Calculators() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("mortgage");
  const Active = TABS.find((t) => t.key === tab)!.comp;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              tab === t.key ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Icon name={t.icon} size="1em" /> {t.label}
          </button>
        ))}
      </div>
      <div className="glass-card p-5 sm:p-6">
        <Active />
      </div>
    </div>
  );
}
