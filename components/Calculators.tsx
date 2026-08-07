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
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";

const fmt = (v: number, digits = 0) =>
  Number.isFinite(v) ? v.toLocaleString("he-IL", { maximumFractionDigits: digits }) : "—";

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

/* ── 1 · mortgage (שפיצר) ────────────────────────────────────────────────── */

function MortgageCalc() {
  const [amount, setAmount] = useState(1_000_000);
  const [rate, setRate] = useState(4.9);
  const [years, setYears] = useState(25);

  const r = rate / 100 / 12;
  const n = years * 12;
  const monthly = useMemo(() => {
    if (amount <= 0 || n <= 0) return NaN;
    if (r === 0) return amount / n;
    return (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }, [amount, r, n]);
  const total = monthly * n;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="סכום המשכנתא" value={amount} onChange={setAmount} suffix="₪" step={10000} />
        <Field label="ריבית שנתית" value={rate} onChange={setRate} suffix="%" step={0.1} />
        <Field label="תקופה" value={years} onChange={setYears} suffix="שנים" />
      </div>
      <div className="grid content-start gap-3 sm:grid-cols-2">
        <Result label="החזר חודשי" value={`₪${fmt(monthly)}`} accent />
        <Result label="סה״כ החזר" value={`₪${fmt(total)}`} sub={`מתוכו ריבית ₪${fmt(total - amount)}`} />
      </div>
      <p className="text-2xs leading-relaxed text-slate-400 lg:col-span-2">
        לוח שפיצר בריבית קבועה. משכנתא אמיתית מורכבת ממסלולים מעורבים (פריים, צמודה, קבועה) —
        המספר כאן הוא סדר גודל לתכנון, לא הצעת בנק.
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
    const loan = Math.max(0, price - equity);
    const r = mortgageRate / 100 / 12;
    const n = mortgageYears * 12;
    const pay = loan <= 0 ? 0 : r === 0 ? loan / n : (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
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
          value={`${calc.cashflow >= 0 ? "+" : "−"}₪${fmt(Math.abs(calc.cashflow))}`}
          sub={calc.cashflow >= 0 ? "הנכס מכסה את עצמו" : "דורש השלמה מהכיס"}
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
    const roi = renoCost > 0 ? ((afterValue - buyPrice - renoCost) / renoCost) * 100 : NaN;
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
          value={`${calc.equityGain >= 0 ? "+" : "−"}₪${fmt(Math.abs(calc.equityGain))}`}
          accent
          sub={Number.isFinite(calc.roi) ? `תשואה על עלות השיפוץ: ${fmt(calc.roi)}%` : undefined}
        />
        <Result label="תוספת שכירות" value={`+₪${fmt(calc.rentUplift)}/חודש`} />
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
  { key: "mortgage", label: "משכנתא", icon: "institution", comp: MortgageCalc },
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
