import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * The registration/unlock interstitial a visitor meets instead of a gated city
 * page. Three states, all decided server-side in app/city/[slug]/page.tsx:
 *
 *   "anonymous"     — no account: the pitch + register CTA.
 *   "locked"        — signed in, city not unlocked: show cost + unlock button
 *                     (a FORM POST — never unlock on GET, or link prefetch
 *                     would silently spend the user's credits).
 *   "insufficient"  — signed in, balance below cost: how to earn more.
 *
 * Deliberately a full page rather than a blurred overlay: the data must not be
 * in the HTML at all — an overlay hides nothing from view-source.
 */
export default function CityWall({
  cityName,
  state,
  balanceCredits,
  costCredits,
  unlockDays,
  demoCity,
  shareUrl,
  refCode,
  signupBonus,
  referralBonus,
  feedbackBonus,
  monthlyGrant,
  unlockAction,
}: {
  cityName: string;
  state: "anonymous" | "locked" | "insufficient";
  balanceCredits?: number;
  costCredits?: number;
  unlockDays?: number;
  demoCity?: string;
  shareUrl?: string;
  /** the sharer's referral code from ?ref= — must survive the trip into /register */
  refCode?: string;
  /** live rule values — NEVER hardcode these; the admin can change them without a deploy */
  signupBonus?: number;
  referralBonus?: number;
  feedbackBonus?: number;
  monthlyGrant?: number;
  unlockAction?: (formData: FormData) => Promise<void>;
}) {
  const refSuffix = refCode ? `&ref=${refCode}` : "";
  const fmt = (n: number | undefined) =>
    n == null ? "" : (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="glass-card p-8 sm:p-10">
        <div className="mb-3 text-4xl"><Icon name="lock" size="1em" /></div>
        <h1 className="text-2xl font-black text-slate-900">{cityName}</h1>

        {state === "anonymous" && (
          <>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              עמודי הערים — עם כל הגרפים, העסקאות והדירוגים — פתוחים למשתמשים רשומים.
              ההרשמה חינם ומקנה <b>{signupBonus ?? 10} קרדיטים</b> לפתיחת הערים שמעניינות אותך.
            </p>
            {demoCity && (
              <p className="mt-2 text-xs text-slate-500">
                רוצה לראות איך עמוד עיר נראה מבפנים? <Link href={`/city/${encodeURIComponent(demoCity)}`} className="font-bold text-indigo-700 hover:underline">עמוד {demoCity} פתוח לכולם</Link>.
              </p>
            )}
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                href={`/register?next=${encodeURIComponent(`/city/${encodeURIComponent(cityName)}`)}${refSuffix}`}
                className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700 sm:w-auto"
              >
                הרשמה חינם — {signupBonus ?? 10} קרדיטים
              </Link>
              <Link
                href={`/login?next=${encodeURIComponent(`/city/${encodeURIComponent(cityName)}`)}`}
                className="w-full rounded-xl border border-slate-200 px-6 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 sm:w-auto"
              >
                כבר רשום? התחברות
              </Link>
            </div>
          </>
        )}

        {state === "locked" && unlockAction && (
          <>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              פתיחת עמוד העיר עולה <b>{fmt(costCredits)} קרדיט</b> ומקנה גישה חופשית
              ל-<b>{unlockDays} ימים</b>. היתרה שלך: <b>{fmt(balanceCredits)} קרדיטים</b>.
            </p>
            <form action={unlockAction} className="mt-6">
              <button className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-bold text-white hover:bg-indigo-700">
                פתח את {cityName} — {fmt(costCredits)} קרדיט
              </button>
            </form>
          </>
        )}

        {state === "insufficient" && (
          <>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              פתיחת עיר עולה <b>{fmt(costCredits)} קרדיט</b>, והיתרה שלך עומדת על <b>{fmt(balanceCredits)}</b>.
            </p>
            <div className="mx-auto mt-5 max-w-md rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-right text-sm text-slate-700">
              <p className="font-bold text-slate-900">איך מרוויחים עוד קרדיטים?</p>
              <ul className="mt-2 space-y-1.5">
                <li>🤝 הזמנת חבר שנרשם — <b>+{referralBonus ?? 10} קרדיטים</b> (ללא הגבלה)</li>
                <li>💬 כל משוב איכותי שאושר — <b>+{feedbackBonus ?? 5} קרדיטים</b></li>
                {(monthlyGrant ?? 0) > 0 && <li>🎁 מענק חודשי (+{monthlyGrant}) מתחדש אוטומטית</li>}
              </ul>
            </div>
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-700"
              >
                שתף חבר בוואטסאפ — קבל 5 קרדיטים כשיירשם
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
