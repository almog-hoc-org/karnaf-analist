import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyLogin, createSession } from "@/lib/auth";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";
import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

export const metadata = { title: "התחברות | קרנף אנליסט" };
export const dynamic = "force-dynamic";

/** Only same-site paths — never bounce a login to an attacker-supplied host. */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/deals";
}

async function doLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  // Two budgets, because they stop different attacks: per-IP caps someone
  // spraying many accounts from one host, per-account caps a distributed run
  // against one inbox. A successful login clears both.
  const ip = clientIp(headers());
  const acct = email.trim().toLowerCase().slice(0, 254);
  const byIp = rateLimit(`login-ip:${ip}`, 10, 15 * 60_000);
  const byAcct = rateLimit(`login-acct:${acct}`, 8, 15 * 60_000);
  if (!byIp.ok || !byAcct.ok) redirect(`/login?err=rate&next=${encodeURIComponent(next)}`);

  const user = verifyLogin(email, password);
  if (!user) redirect(`/login?err=1&next=${encodeURIComponent(next)}`);

  rateLimitReset(`login-ip:${ip}`);
  rateLimitReset(`login-acct:${acct}`);
  createSession(user);
  redirect(next);
}

export default function LoginPage({ searchParams }: { searchParams?: { err?: string; next?: string } }) {
  const next = safeNext(searchParams?.next);
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={doLogin} className="glass-card w-full max-w-sm p-8">
        <div className="mb-5 text-center">
          <div className="mb-2 text-3xl"><Icon name="rhino" size="1em" /></div>
          <h1 className="text-xl font-black text-slate-900">התחברות לקרנף אנליסט</h1>
          <p className="mt-1 text-xs text-slate-500">הסביבה האישית שלך — ערים במעקב ועסקאות</p>
        </div>
        {searchParams?.err && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            {searchParams.err === "rate"
              ? "יותר מדי ניסיונות — נסה שוב בעוד מספר דקות"
              : searchParams.err === "1"
                ? "אימייל או סיסמה שגויים"
                : searchParams.err /* Google-callback messages arrive pre-written */}
          </p>
        )}
        <input type="hidden" name="next" value={next} />
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder="סיסמה" required
          className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">כניסה</button>

        {!!process.env.GOOGLE_CLIENT_ID && (
          <>
            <div className="my-4 flex items-center gap-3 text-2xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> או <span className="h-px flex-1 bg-slate-200" />
            </div>
            <a
              href={withBasePath(`/api/auth/google?next=${encodeURIComponent(next)}`)}
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
          אין לך חשבון?{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-bold text-indigo-700 hover:underline">הרשמה</Link>
        </p>
        <p className="mt-2 text-center text-2xs text-slate-400">
          ההרשמה חינם ומקנה קרדיטים לפתיחת עמודי ערים
        </p>
        <div className="mt-4 border-t border-slate-100 pt-3 text-center">
          <Link href="/admin" className="text-2xs font-bold text-slate-400 hover:text-indigo-700">
            <Icon name="cursor" size="1em" /> ניהול דאטה (מנהל מערכת)
          </Link>
        </div>
      </form>
    </main>
  );
}
