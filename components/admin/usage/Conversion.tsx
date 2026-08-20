"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import FunnelChart from "@/components/admin/FunnelChart";
import KpiTile from "@/components/admin/KpiTile";
import DataTable from "@/components/admin/DataTable";
import PageName from "@/components/admin/PageName";
import Icon from "@/components/Icon";
import { labelForPath } from "@/lib/pageLabels";
import { share, type UsagePayload } from "@/lib/usagePayload";
import type { LandingConversion } from "@/lib/events";

/**
 * Activation: does a visit become an account, and does the account reach value.
 *
 * Ranked second only to retention in every framework, and first in practice
 * for a product with a paywall — an audience that never converts is a cost.
 *
 * The time-to-value tile is the one to watch. An account that opens its first
 * city in the same sitting behaves very differently from one that comes back
 * three days later to try, and the median hour count is the earliest warning
 * that onboarding has a gap in it.
 */

function humanMinutes(m: number | null): string {
  if (m == null) return "—";
  if (m < 60) return `${m} דק׳`;
  if (m < 1440) return `${(m / 60).toFixed(1)} שע׳`;
  return `${(m / 1440).toFixed(1)} ימים`;
}

export default function Conversion({ data }: { data: UsagePayload }) {
  const { funnel, ttfv, credits } = data;
  const top = funnel[0]?.n ?? 0;
  const registered = funnel.find((f) => f.key === "registered")?.n ?? 0;
  const unlocked = funnel.find((f) => f.key === "unlocked")?.n ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile
          label="המרה כוללת" value={top ? `${share(registered, top)}%` : "—"}
          sub={`${registered} חשבונות מ-${top} ביקורי עיר`}
          hint="מביקור בעמוד עיר ועד חשבון. אלו אינם אותם אנשים בהכרח — זו השוואת כמויות באותה תקופה, כמו בכל משפך."
        />
        <KpiTile
          label="הפעלה" value={registered ? `${share(unlocked, registered)}%` : "—"}
          sub={`${unlocked} פתחו עיר`}
          hint="מהנרשמים — כמה הגיעו לערך בפועל ולא רק פתחו חשבון."
        />
        <KpiTile
          label="זמן לערך ראשון" value={humanMinutes(ttfv.medianMinutes)}
          sub={ttfv.n ? `חציון · ${ttfv.within24hPct}% תוך יממה` : "אין עדיין נתונים"}
          goodWhenUp={false}
          hint="מההרשמה ועד פתיחת העיר הראשונה. המדד הכי מנבא לשאלה אם חשבון שורד."
        />
        <KpiTile
          label="קרדיטים לא מנוצלים" value={String(credits.outstanding)}
          sub={`אצל ${credits.usersWithBalance} חשבונות`}
          goodWhenUp={false}
          hint="נספר על פני כל הזמן ולא רק בחלון — קרדיט שהוענק ברבעון שעבר ולא נוצל הוא בדיוק מה שהמספר תופס."
        />
      </div>

      <CollapsibleCard
        id="cv-funnel" defaultOpen
        title="🎯 המשפך"
        summary={top ? `${top} → ${unlocked}` : "אין תנועה"}
        hint="כל שלב נספר מהמקור הישיר ביותר: צפיות וחשיפות מלוג האירועים, וכל מה שאחרי ההרשמה מהטבלה שרושמת את התוצאה עצמה — כפתור אפשר לפספס, שורה בטבלה לא. הנשירה הגדולה ביותר מסומנת: שם העבודה משתלמת הכי הרבה."
      >
        <FunnelChart stages={funnel} />
        {data.neverUnlocked > 0 && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            <Icon name="warning" size="1em" /> <b>{data.neverUnlocked}</b> חשבונות נרשמו ומעולם לא פתחו עיר.
            זו נקודת הכשל הזולה ביותר לתיקון — הם כבר עברו את השלב הקשה.
          </p>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="cv-landing" defaultOpen
        title="🛬 המרה לפי עמוד נחיתה"
        summary={`${data.landingConversion.length} עמודי כניסה`}
        hint="עמוד יכול להביא הרבה תנועה ואפס משתמשים, ושני הדברים יושבים בטבלאות שונות — ולכן מתבלבלים. ביקור נחשב ״המיר״ אם בהמשכו הופיע חשבון מחובר או פתיחת עיר."
      >
        <DataTable<LandingConversion>
          rows={data.landingConversion}
          initialSort="sessions"
          csvName="landing-conversion"
          maxRows={10}
          columns={[
            { key: "path", label: "עמוד כניסה", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
            { key: "sessions", label: "ביקורים", align: "end", bar: true, sort: (r) => r.sessions },
            { key: "converted", label: "המירו", align: "end", sort: (r) => r.converted },
            {
              key: "convPct", label: "% המרה", align: "end", sort: (r) => r.convPct,
              render: (r) => (
                <span className={r.convPct >= 20 ? "font-bold text-emerald-700" : r.convPct === 0 ? "text-slate-300" : "text-slate-700"}>
                  {r.convPct}%
                </span>
              ),
            },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="cv-credits"
        title="🪙 כלכלת הקרדיטים"
        summary={`${credits.granted} הוענקו · ${credits.spent} נוצלו`}
        hint="שיעור ניצול נמוך אומר שהמטבע לא מניע פעולה — או שהוא נדיב מדי מכדי שיהיה לו ערך, או שלא ברור מה עושים איתו."
      >
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          {[
            ["הוענקו", credits.granted],
            ["נוצלו", credits.spent],
            ["שיעור ניצול", credits.granted ? `${share(credits.spent, credits.granted)}%` : "—"],
            ["פתיחות ערים", credits.unlocks],
            ["יתרה לא מנוצלת", credits.outstanding],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-2xs text-slate-500">{k}</dt>
              <dd className="text-lg font-black tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleCard>
    </div>
  );
}
