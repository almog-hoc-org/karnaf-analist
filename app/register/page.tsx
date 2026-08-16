import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { registerUser, verifyLogin, createSession, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { grantSignupBonus, applyReferral, CREDIT_RULES } from "@/lib/credits";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

export const metadata = { title: "הרשמה | קרנף אנליסט" };
export const dynamic = "force-dynamic";

/** Only same-site paths — never bounce a registration to an attacker-supplied host. */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/deals";
}

/** Referral codes are short alphanumerics — anything else is dropped, not errored. */
function safeRef(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z2-9]{4,16}$/.test(s) ? s : "";
}

async function doRegister(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const mailingConsent = formData.get("mailing_consent") === "on";
  const next = safeNext(formData.get("next"));
  const ref = safeRef(formData.get("ref"));

  // Account creation is cheap for us and valuable to a spammer — 5 per hour per
  // IP is generous for a real person and useless for bulk signup.
  const ip = clientIp(headers());
  const gate = rateLimit(`register:${ip}`, 5, 60 * 60_000);
  if (!gate.ok) {
    redirect(`/register?err=${encodeURIComponent("יותר מדי ניסיונות — נסה שוב בעוד שעה")}&next=${encodeURIComponent(next)}`);
  }

  // Consent is REQUIRED to register (operator decision 9.8) — enforced here
  // as well as in the form, because a form attribute alone is a suggestion.
  if (!mailingConsent) {
    redirect(`/register?err=${encodeURIComponent("ההרשמה כוללת הסכמה לקבלת עדכונים במייל")}&next=${encodeURIComponent(next)}`);
  }

  const res = registerUser(email, name, password, { phone, mailingConsent });
  if (!res.ok) redirect(`/register?err=${encodeURIComponent(res.error)}&next=${encodeURIComponent(next)}`);

  // credits: starter balance for the new account, referral bonus for whoever
  // sent them (capped + validated inside applyReferral — the form is not trusted)
  grantSignupBonus(res.userId);
  if (ref) applyReferral(ref, res.userId);

  const user = verifyLogin(email, password);
  if (user) createSession(user);
  redirect(next);
}

export default function RegisterPage({ searchParams }: { searchParams?: { err?: string; next?: string; ref?: string } }) {
  const next = safeNext(searchParams?.next);
  const ref = safeRef(searchParams?.ref);
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID;
  const googleHref = withBasePath(
    `/api/auth/google?next=${encodeURIComponent(next)}${ref ? `&ref=${ref}` : ""}`
  );
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={doRegister} className="glass-card w-full max-w-sm p-8">
        <div className="mb-5 text-center">
          <div className="mb-2 text-3xl"><Icon name="rhino" size="1em" /></div>
          <h1 className="text-xl font-black text-slate-900">פתיחת חשבון</h1>
          <p className="mt-1 text-xs text-slate-500">
            הרשמה חינם · <b className="text-indigo-700">{CREDIT_RULES.signupBonus() + (ref ? CREDIT_RULES.referralInviteeBonus() : 0)} קרדיטים</b> לפתיחת ערים מתנה
          </p>
        </div>
        {/* Arriving through a friend's link is worth more, and the page has to
            say so BEFORE the form — a bonus discovered after signing up cannot
            persuade anyone to sign up. */}
        {ref && CREDIT_RULES.referralInviteeBonus() > 0 && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
            הגעת דרך הזמנה של חבר — {CREDIT_RULES.referralInviteeBonus()} קרדיטים נוספים מחכים לך
          </p>
        )}
        {searchParams?.err && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            {searchParams.err}
          </p>
        )}
        <input type="hidden" name="next" value={next} />
        {ref && <input type="hidden" name="ref" value={ref} />}
        <input name="name" placeholder="שם מלא" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="phone" type="tel" placeholder="טלפון (לא חובה)" dir="ltr" autoComplete="tel"
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder={`סיסמה (${MIN_PASSWORD_LENGTH}+ תווים)`}
          minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <label className="mb-4 flex items-start gap-2 text-xs text-slate-500">
          <input type="checkbox" name="mailing_consent" defaultChecked required className="mt-0.5" />
          <span>אני מאשר/ת קבלת עדכוני שוק ותובנות במייל — חלק מההרשמה (אפשר לבטל בכל רגע)</span>
        </label>
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">צור חשבון</button>

        {googleEnabled && (
          <>
            <div className="my-4 flex items-center gap-3 text-2xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> או <span className="h-px flex-1 bg-slate-200" />
            </div>
            <a
              href={googleHref}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
                <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
                <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.5-5.8c-2.1 1.4-4.7 2.2-7.5 2.2-6.3 0-11.7-3.7-13.6-9.2l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              המשך עם Google
            </a>
            <p className="mt-1.5 text-center text-2xs text-slate-400">
              הרשמה עם גוגל כוללת הסכמה לקבלת עדכוני שוק במייל (ניתן לבטל בכל עת)
            </p>
          </>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          כבר רשום?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-indigo-700 hover:underline">התחברות</Link>
        </p>
      </form>
    </main>
  );
}
