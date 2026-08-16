import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { appDb } from "@/lib/appDb";
import { balance, ledgerFor, unlockedCities, referralCodeFor, ensureStarterCredits, CREDIT_RULES, isUnlimited } from "@/lib/credits";
import { shareUrlFor, whatsappShareUrl } from "@/lib/share";
import Icon from "@/components/Icon";

export const metadata = { title: "החשבון שלי | קרנף אנליסט" };
export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  signup: "בונוס הרשמה",
  city_unlock: "פתיחת עיר",
  deal_save: "שמירת עסקה",
  referral: "הזמנת חבר 🎉",
  feedback: "משוב שאושר",
  monthly_grant: "מענק חודשי",
  admin: "עדכון מנהל",
  subscription: "מנוי",
};

function fmtCredits(tenths: number): string {
  const c = tenths / 10;
  return Number.isInteger(c) ? String(c) : c.toFixed(1);
}

async function toggleMailing() {
  "use server";
  const u = getCurrentUser();
  if (!u) return;
  appDb().prepare("UPDATE users SET mailing_consent = CASE mailing_consent WHEN 1 THEN 0 ELSE 1 END WHERE id=?")
    .run(Number(u.id.slice(1)));
  revalidatePath("/account");
}

export default function AccountPage() {
  const user = getCurrentUser();
  if (!user) redirect("/login?next=/account");

  // settle anything owed (retro signup bonus for pre-credits accounts, monthly grant)
  ensureStarterCredits(user.id);

  const mailingOn = !!(appDb().prepare("SELECT mailing_consent FROM users WHERE id=?")
    .get(Number(user.id.slice(1))) as { mailing_consent: number } | undefined)?.mailing_consent;

  const bal = balance(user.id);
  const noLimit = isUnlimited(user.id);
  const entries = ledgerFor(user.id, 30);
  const unlocked = unlockedCities(user.id);
  const code = referralCodeFor(user.id);
  const shareLink = shareUrlFor("/", user.id);
  const waHref = whatsappShareUrl("/", user.id, "מצאתי כלי מחקר נדל״ן עם נתוני אמת — שווה הצצה:");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-black text-slate-900">שלום, {user.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>
        {/* the unsubscribe mechanism every broadcast email links to */}
        <form action={toggleMailing} className="mt-2">
          <button className="text-xs font-semibold text-slate-500 underline decoration-slate-300 hover:text-slate-700">
            {mailingOn ? "מקבל עדכוני שוק במייל · לחץ להסרה מרשימת הדיוור" : "לא רשום לדיוור · לחץ להצטרפות לעדכוני שוק במייל"}
          </button>
        </form>
      </header>

      {/* balance + how to earn */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="glass-card p-6 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">היתרה שלך</p>
          <p className="mt-2 text-5xl font-black text-indigo-700">{noLimit ? "∞" : Number.isInteger(bal) ? bal : bal.toFixed(1)}</p>
          {noLimit ? (
            <p className="mt-1 text-sm text-slate-500">גישה ללא הגבלה · כל הערים פתוחות, ללא פקיעה</p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">קרדיטים · פתיחת עיר = {CREDIT_RULES.cityUnlockCost()} קרדיט ל-{CREDIT_RULES.unlockDays()} ימים</p>
          )}
        </div>
        <div className="glass-card p-6">
          {/* "how to earn more" is noise for an account that cannot run out —
              the referral link below still stands on its own. */}
          <p className="text-sm font-bold text-slate-900">{noLimit ? "החשבון שלך" : "להרוויח עוד קרדיטים"}</p>
          {noLimit && (
            <p className="mt-2 text-sm text-slate-600">
              גישה ללא הגבלה לכל הערים ולכל הכלים. אין מה לצבור ואין מה לחדש.
            </p>
          )}
          <ul className={`mt-2 space-y-1.5 text-sm text-slate-600 ${noLimit ? "hidden" : ""}`}>
            <li>🤝 חבר שנרשם דרך הקישור שלך — <b>+{CREDIT_RULES.referralBonus()}</b></li>
            <li>💬 כל משוב איכותי שאושר — <b>+{CREDIT_RULES.feedbackBonus()}</b>{CREDIT_RULES.feedbackMonthlyCap() > 0 && <> (עד {CREDIT_RULES.feedbackMonthlyCap()} בחודש)</>}</li>
            {CREDIT_RULES.monthlyFreeGrant() > 0 && (
              <li>🎁 מענק חודשי — <b>+{CREDIT_RULES.monthlyFreeGrant()}</b> אוטומטית</li>
            )}
          </ul>
        </div>
      </section>

      {/* referral */}
      <section className="glass-card mb-8 p-6">
        <h2 className="text-lg font-bold text-slate-900"><Icon name="link" size="1em" /> הקישור האישי שלך</h2>
        <p className="mt-1 text-sm text-slate-600">
          כל חבר שנרשם דרכו מזכה אותך ב-<b>{CREDIT_RULES.referralBonus()} קרדיטים</b>. הקוד שלך: <b dir="ltr">{code}</b>
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code dir="ltr" className="flex-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{shareLink}</code>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-emerald-700"
          >
            שתף בוואטסאפ
          </a>
        </div>
      </section>

      {/* unlocked cities */}
      <section className="glass-card mb-8 p-6">
        <h2 className="text-lg font-bold text-slate-900"><Icon name="door" size="1em" /> ערים פתוחות</h2>
        {unlocked.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">עוד לא פתחת ערים. כל הערים מחכות לך <Link href="/cities" className="font-bold text-indigo-700 hover:underline">בטבלת הערים</Link>.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {unlocked.map((u) => (
              <li key={u.city_name}>
                <Link href={`/city/${encodeURIComponent(u.city_name)}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-indigo-300">
                  <span className="font-bold text-slate-800">{u.city_name}</span>
                  <span className="text-2xs text-slate-400">עד {new Date(u.expires_at.replace(" ", "T") + "Z").toLocaleDateString("he-IL")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ledger */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-bold text-slate-900"><Icon name="clipboard" size="1em" /> תנועות אחרונות</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">אין תנועות עדיין.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 text-slate-700">{REASON_LABELS[e.reason] ?? e.reason}{e.ref_id && e.reason === "city_unlock" ? ` — ${e.ref_id}` : ""}</td>
                  <td className={`py-2 text-left font-bold ${e.delta_tenths >= 0 ? "text-emerald-600" : "text-red-500"}`} dir="ltr">
                    {e.delta_tenths >= 0 ? "+" : ""}{fmtCredits(e.delta_tenths)}
                  </td>
                  <td className="py-2 pr-3 text-left text-2xs text-slate-400" dir="ltr">
                    {new Date(e.created_at.replace(" ", "T") + "Z").toLocaleDateString("he-IL")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
