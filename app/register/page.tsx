import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { registerUser, verifyLogin, createSession, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const metadata = { title: "הרשמה | קרנף אנליסט" };
export const dynamic = "force-dynamic";

/** Only same-site paths — never bounce a registration to an attacker-supplied host. */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/deals";
}

async function doRegister(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  // Account creation is cheap for us and valuable to a spammer — 5 per hour per
  // IP is generous for a real person and useless for bulk signup.
  const ip = clientIp(headers());
  const gate = rateLimit(`register:${ip}`, 5, 60 * 60_000);
  if (!gate.ok) {
    redirect(`/register?err=${encodeURIComponent("יותר מדי ניסיונות — נסה שוב בעוד שעה")}&next=${encodeURIComponent(next)}`);
  }

  const res = registerUser(email, name, password);
  if (!res.ok) redirect(`/register?err=${encodeURIComponent(res.error)}&next=${encodeURIComponent(next)}`);
  const user = verifyLogin(email, password);
  if (user) createSession(user);
  redirect(next);
}

export default function RegisterPage({ searchParams }: { searchParams?: { err?: string; next?: string } }) {
  const next = safeNext(searchParams?.next);
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={doRegister} className="glass-card w-full max-w-sm p-8">
        <div className="mb-5 text-center">
          <div className="mb-2 text-3xl">🦏</div>
          <h1 className="text-xl font-black text-slate-900">פתיחת חשבון</h1>
          <p className="mt-1 text-xs text-slate-500">שמור את הערים והעסקאות שלך בסביבה אישית</p>
        </div>
        {searchParams?.err && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            {searchParams.err}
          </p>
        )}
        <input type="hidden" name="next" value={next} />
        <input name="name" placeholder="שם מלא" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder={`סיסמה (${MIN_PASSWORD_LENGTH}+ תווים)`}
          minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required
          className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">צור חשבון</button>
        <p className="mt-4 text-center text-xs text-slate-500">
          כבר רשום?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-indigo-700 hover:underline">התחברות</Link>
        </p>
      </form>
    </main>
  );
}
