import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminToken } from "@/lib/adminAuth";

export const metadata = { title: "כניסת מנהל | קרנף אנליסט" };

async function login(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? "");
  if (process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD) {
    cookies().set(ADMIN_COOKIE, adminToken()!, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
  }
  redirect("/admin");
}

export default function AdminLogin() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={login} className="glass-card w-full max-w-sm p-8 text-center">
        <div className="mb-3 text-3xl">🔐</div>
        <h1 className="mb-1 text-xl font-black text-slate-900">כניסת מנהל</h1>
        <p className="mb-5 text-xs text-slate-500">דשבורד ניהול הדאטה של קרנף אנליסט</p>
        <input name="password" type="password" placeholder="סיסמת מנהל" autoFocus
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">כניסה</button>
      </form>
    </main>
  );
}
