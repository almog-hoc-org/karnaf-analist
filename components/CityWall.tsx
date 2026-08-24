import Icon from "@/components/Icon";
import TrackOnMount from "@/components/TrackOnMount";
import CtaLink from "@/components/CtaLink";

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
  shareUrl,
  refCode,
  anonFreeUsed = 0,
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
  shareUrl?: string;
  /** the sharer's referral code from ?ref= — must survive the trip into /register */
  refCode?: string;
  /** how many free cities this browser already used up — 0 when the free tier is
   *  off. Not a number on screen any more, only the difference between
   *  "more cities" and "cities". */
  anonFreeUsed?: number;
  /** live rule values — NEVER hardcode these; the admin can change them without a deploy */
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
      <TrackOnMount name="unlock_prompt_seen" subject={cityName} detail={state} />
      <div className="glass-card p-8 sm:p-10">
        <div className="mb-3 text-4xl"><Icon name="lock" size="1em" /></div>
        <h1 className="text-2xl font-black text-slate-900">{cityName}</h1>

        {state === "anonymous" && (
          <>
            {/* ONE SENTENCE. This screen used to say six things — how many free
                cities were spent, that signing up is free, how many credits it
                grants, what one credit buys and for how long, that we do not
                spam, and that there is a demo city — and five of them answer
                questions the visitor has not asked yet. What stops them here is
                a single fact: reading more cities needs an account. Everything
                that happens AFTER the account exists can be learned after it
                exists.

                "עוד" is conditional and not fixed: a visitor normally arrives
                here having spent the free allowance, but with the free tier
                switched off (anon_free_cities = 0) they arrive having seen
                none, and "more cities" would then be a lie about their own
                history. */}
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              לצפייה ב{anonFreeUsed > 0 ? "עוד " : ""}<b>ערים</b> צריך חשבון.
              ההרשמה <b>חינם ומהירה</b> — עם גוגל או מייל.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <CtaLink
                cta="register"
                context={cityName}
                /* refSuffix stays even though the invitee bonus is no longer
                   shown: the sharer's referral code still has to survive the
                   trip into /register, or the credit lands nowhere. */
                href={`/register?next=${encodeURIComponent(`/city/${encodeURIComponent(cityName)}`)}${refSuffix}`}
                className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700 sm:w-auto"
              >
                הרשמה מהירה — חינם
              </CtaLink>
              <CtaLink
                cta="login"
                context={cityName}
                href={`/login?next=${encodeURIComponent(`/city/${encodeURIComponent(cityName)}`)}`}
                className="w-full rounded-xl border border-slate-200 px-6 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 sm:w-auto"
              >
                כבר רשום? התחברות
              </CtaLink>
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
                {/* the number MUST come from the same prop as the bullet three
                    lines above — a hardcoded 5 sat here while the list said 10,
                    so one screen promised two different rewards */}
                שתף חבר בוואטסאפ — קבל {referralBonus ?? 10} קרדיטים כשיירשם
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
