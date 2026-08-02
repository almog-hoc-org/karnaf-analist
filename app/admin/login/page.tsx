import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import crypto from "crypto";
import { ADMIN_COOKIE, adminToken, adminConfigured } from "@/lib/adminAuth";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";

export const metadata = { title: "כניסת מנהל | קרנף אנליסט" };
export const dynamic = "force-dynamic";

/** Constant-time compare that tolerates a length mismatch instead of throwing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function login(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? "");
  const ip = clientIp(headers());

  // 5 attempts per 15 minutes, then a 15-minute lockout. The admin password is
  // the most valuable credential here, so this budget is deliberately tighter
  // than the public login form's. Previously the form accepted unlimited
  // guesses and gave no feedback either way.
  const gate = rateLimit(`admin-login:${ip}`, 5, 15 * 60_000);
  if (!gate.ok) redirect(`/admin/login?err=rate`);

  const expected = process.env.ADMIN_PASSWORD;
  const token = adminToken();
  if (!expected || !token) redirect("/admin/login?err=unconfigured");

  if (!safeEqual(pw, expected)) redirect("/admin/login?err=bad");

  rateLimitReset(`admin-login:${ip}`);
  cookies().set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h — an admin session shouldn't outlive a working day
  });
  redirect("/admin");
}

const MESSAGES: Record<string, string> = {
  bad: "סיסמה שגויה",
  rate: "יותר מדי ניסיונות — נסה שוב בעוד מספר דקות",
  unconfigured: "לוח הניהול אינו מוגדר בשרת (חסר ADMIN_PASSWORD)",
};

export default function AdminLogin({ searchParams }: { searchParams?: { err?: string } }) {
  const err = searchParams?.err ? MESSAGES[searchParams.err] ?? "שגיאה" : null;
  const configured = adminConfigured();

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <form action={login} className="glass-card w-full max-w-sm p-8 text-center">
        <div className="mb-3 text-3xl">🔐</div>
        <h1 className="mb-1 text-xl font-black text-slate-900">כניסת מנהל</h1>
        <p className="mb-5 text-xs text-slate-500">דשבורד ניהול הדאטה של קרנף אנליסט</p>

        {err && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            {err}
          </p>
        )}

        {!configured && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-start text-2xs leading-relaxed text-amber-800">
            לא הוגדר <code className="font-mono">ADMIN_PASSWORD</code> בשרת, ולכן לוח הניהול חסום.
            זו התנהגות מכוונת — היעדר סיסמה נועל את הגישה במקום לפתוח אותה לכולם.
          </p>
        )}

        {/* text-base on mobile: iOS zooms into any input under 16px on focus */}
        <input
          name="password"
          type="password"
          placeholder="סיסמת מנהל"
          autoFocus
          autoComplete="current-password"
          disabled={!configured}
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-base focus:border-indigo-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 sm:text-sm"
        />
        <button
          disabled={!configured}
          className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          כניסה
        </button>
      </form>
    </main>
  );
}
