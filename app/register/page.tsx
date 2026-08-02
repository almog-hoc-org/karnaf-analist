import Link from "next/link";
import { redirect } from "next/navigation";
import { registerUser, verifyLogin, createSession } from "@/lib/auth";

export const metadata = { title: "הרשמה | קרנף אנליסט" };

async function doRegister(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const res = registerUser(email, name, password);
  if (!res.ok) redirect(`/register?err=${encodeURIComponent(res.error)}`);
  const user = verifyLogin(email, password);
  if (user) createSession(user);
  redirect("/deals");
}

export default function RegisterPage({ searchParams }: { searchParams?: { err?: string } }) {
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
        <input name="name" placeholder="שם מלא" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="email" type="email" placeholder="אימייל" dir="ltr" required
          className="mb-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input name="password" type="password" placeholder="סיסמה (6+ תווים)" required
          className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">צור חשבון</button>
        <p className="mt-4 text-center text-xs text-slate-500">
          כבר רשום? <Link href="/login" className="font-bold text-indigo-700 hover:underline">התחברות</Link>
        </p>
      </form>
    </main>
  );
}
