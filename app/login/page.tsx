import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyLogin, createSession } from "@/lib/auth";

export const metadata = { title: "התחברות | קרנף אנליסט" };

async function doLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const user = verifyLogin(email, password);
  if (!user) redirect("/login?err=1");
  createSession(user);
  redirect("/deals");
}

export default function LoginPage({ searchParams }: { searchParams?: { err?: string } }) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={doLogin} className="glass-card w-full max-w-sm p-8">
        <div className="mb-5 text-center">
          <div className="mb-2 text-3xl">🦏</div>
          <h1 className="text-xl font-black text-slate-900">התחברות לקרנף אנליסט</h1>
          <p className="mt-1 text-xs text-slate-500">הסביבה האישית שלך — ערים במעקב ועסקאות</p>
        </div>
        {searchParams?.err && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            אימייל או סיסמה שגויים
          </p>
        )}
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder="סיסמה" required
          className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">כניסה</button>
        <p className="mt-4 text-center text-xs text-slate-500">
          אין לך חשבון? <Link href="/register" className="font-bold text-indigo-700 hover:underline">הרשמה</Link>
        </p>
        <p className="mt-2 text-center text-2xs text-slate-400">
          האתר פתוח לשימוש גם בלי התחברות — החשבון שומר את הסביבה האישית שלך
        </p>
        <div className="mt-4 border-t border-slate-100 pt-3 text-center">
          <Link href="/admin" className="text-2xs font-bold text-slate-400 hover:text-indigo-700">
            🛠️ ניהול דאטה (מנהל מערכת)
          </Link>
        </div>
      </form>
    </main>
  );
}
