import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyLogin, createSession } from "@/lib/auth";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";
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
              : "אימייל או סיסמה שגויים"}
          </p>
        )}
        <input type="hidden" name="next" value={next} />
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder="סיסמה" required
          className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">כניסה</button>
        <p className="mt-4 text-center text-xs text-slate-500">
          אין לך חשבון?{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-bold text-indigo-700 hover:underline">הרשמה</Link>
        </p>
        <p className="mt-2 text-center text-2xs text-slate-400">
          כל נתוני המחקר באתר פתוחים ללא התחברות — החשבון נדרש רק לסביבה האישית שלך
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
