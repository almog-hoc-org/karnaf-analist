"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import DataTable from "@/components/admin/DataTable";
import KpiTile from "@/components/admin/KpiTile";
import PageName from "@/components/admin/PageName";
import AdminUserUsageTable, { humanSeconds } from "@/components/AdminUserUsageTable";
import { labelForPath } from "@/lib/pageLabels";
import { NOT_YET, type UsagePayload } from "@/lib/usagePayload";
// Google's thresholds live with the insight engine, which also decides when a
// page is "slow" — two copies would let the colour here and the recommendation
// there disagree about the same number.
import { VITAL_LIMITS } from "@/lib/usageInsights";
import type { ExitRow, VitalRow, DeadEndRow } from "@/lib/events";

/**
 * What is broken, slow, or confusing — the tab that exists because the stated
 * purpose of this dashboard is to debug and improve the site.
 *
 * Everything here is a defect report from a visitor who did not write in, and
 * almost none of them ever do. A dead end, a rage click, an error screen and a
 * four-second load are four ways of losing someone silently.
 */

const DEVICE_HE: Record<string, string> = {
  mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב", unknown: "לא ידוע",
};

const isDeadEnd = (e: ExitRow) =>
  e.exitRatePct >= 60 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20 && e.views >= 5;

export default function Quality({ data, days }: { data: UsagePayload; days: number }) {
  const deadEnds = data.exits.filter(isDeadEnd);
  const poorVitals = data.vitals.filter((v) => VITAL_LIMITS[v.metric] && v.p75 > VITAL_LIMITS[v.metric].poor);
  const errorTotal = data.errors.reduce((s, e) => s + e.n, 0);
  const rageTotal = data.rage.reduce((s, r) => s + r.n, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile label="מבואות סתומים" value={String(deadEnds.length)} sub="יציאה גבוהה + שהייה קצרה" goodWhenUp={false} />
        <KpiTile label="מסכי שגיאה" value={String(errorTotal)} sub={`${data.errors.length} סוגים`} goodWhenUp={false} />
        <KpiTile label="לחיצות זעם" value={String(rageTotal)} sub={`${data.rage.length} אלמנטים`} goodWhenUp={false} />
        <KpiTile label="מדידות מהירות חורגות" value={String(poorVitals.length)} sub={`מתוך ${data.vitals.length}`} goodWhenUp={false} />
      </div>

      <CollapsibleCard
        id="ql-exits" defaultOpen
        title="🚪 נקודות עזיבה"
        summary={`${data.exits.length} עמודים${deadEnds.length ? ` · ${deadEnds.length} מבוי סתום` : ""}`}
        hint="שיעור יציאה גבוה אינו רע מעצמו — העמוד האחרון של ביקור מוצלח הוא גם יציאה. מה שהופך אותו לממצא הוא שיעור יציאה גבוה יחד עם שהייה קצרה: הגיעו, ונטשו. שתי העמודות מוצגות כדי ששני המקרים לא יתערבבו."
      >
        <DataTable<ExitRow>
          rows={data.exits}
          initialSort="exits"
          csvName="exits"
          maxRows={12}
          columns={[
            {
              key: "path", label: "עמוד",
              render: (r) => (
                <div className="min-w-0">
                  <PageName path={r.path} />
                  {isDeadEnd(r) && <span className="text-2xs font-bold text-rose-600">⚠ מבוי סתום</span>}
                </div>
              ),
              sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label,
            },
            { key: "views", label: "צפיות", align: "end", sort: (r) => r.views },
            { key: "exits", label: "יציאות", align: "end", bar: true, sort: (r) => r.exits },
            { key: "exitRatePct", label: "% יציאה", align: "end", sort: (r) => r.exitRatePct, render: (r) => `${r.exitRatePct}%` },
            { key: "avgSecondsBeforeExit", label: "זמן לפני עזיבה", align: "end", sort: (r) => r.avgSecondsBeforeExit, render: (r) => humanSeconds(r.avgSecondsBeforeExit) },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="ql-vitals" defaultOpen
        title="⚡ מהירות אצל גולשים אמיתיים"
        summary={data.vitals.length ? `${data.vitals.length} מדידות · ${poorVitals.length} חורגות` : "מתחיל להיאסף"}
        hint="p75 ולא ממוצע: ממוצע נגרר כלפי מטה על ידי הרוב המהיר ומסתיר בדיוק את הזנב האיטי שגורם לנטישה. p75 הוא הסף שגוגל עצמה מודדת מולו, והוא מתאר חוויה שרבע מהגולשים באמת חווים. מפולח לפי מכשיר כי אותו עמוד לרוב איטי פי שניים בטלפון, ומספר מאוחד היה מחביא את זה מאחורי תנועת המחשבים."
      >
        <DataTable<VitalRow>
          rows={data.vitals}
          initialSort="p75"
          csvName="web-vitals"
          maxRows={12}
          empty={NOT_YET}
          columns={[
            { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
            {
              key: "metric", label: "מדד",
              render: (r) => (
                <span title={VITAL_LIMITS[r.metric]?.what} className="font-mono text-2xs text-slate-600">{r.metric}</span>
              ),
              sort: (r) => r.metric,
            },
            { key: "device", label: "מכשיר", render: (r) => DEVICE_HE[r.device] ?? r.device, sort: (r) => r.device },
            {
              key: "p75", label: "p75", align: "end", sort: (r) => r.p75,
              render: (r) => {
                const lim = VITAL_LIMITS[r.metric];
                const tone = !lim ? "text-slate-700"
                  : r.p75 <= lim.good ? "text-emerald-700"
                  : r.p75 <= lim.poor ? "text-amber-700" : "font-bold text-rose-600";
                return <span className={tone}>{r.metric === "CLS" ? (r.p75 / 1000).toFixed(3) : `${r.p75}${lim?.unit ?? ""}`}</span>;
              },
            },
            { key: "n", label: "מדידות", align: "end", sort: (r) => r.n },
          ]}
        />
      </CollapsibleCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CollapsibleCard
          id="ql-rage" defaultOpen
          title="😤 לחיצות זעם"
          summary={rageTotal ? `${rageTotal} לחיצות` : "נקי"}
          hint="שלוש לחיצות על אותו אלמנט תוך שנייה וחצי בלי ניווט: ״נראה לחיץ ואינו״. זה הסיגנל היחיד כאן שמוצא אפורדנס שבור שאף אחד לא היה טורח לדווח עליו."
        >
          <DataTable<DeadEndRow>
            rows={data.rage}
            initialSort="n"
            csvName="rage-clicks"
            empty="אין לחיצות זעם בתקופה — זו התוצאה הרצויה."
            columns={[
              { key: "label", label: "אלמנט", sort: (r) => r.label },
              { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
              { key: "n", label: "פעמים", align: "end", bar: true, sort: (r) => r.n },
            ]}
          />
        </CollapsibleCard>

        <CollapsibleCard
          id="ql-errors" defaultOpen
          title="💥 מסכי שגיאה שגולשים ראו"
          summary={errorTotal ? `${errorTotal} הופעות` : "נקי"}
          hint="הלוג של השרת אומר מה נשבר; זה אומר כמה אנשים ראו ובאיזה עמוד. כשמגדל העמק קרסה, הדרך היחידה שמישהו ידע הייתה שאתה במקרה לחצת עליה — גולש שנתקל באותו מסך לא השאיר שום עקבה."
        >
          <DataTable<{ path: string; detail: string; n: number }>
            rows={data.errors}
            initialSort="n"
            csvName="errors"
            empty="אין מסכי שגיאה בתקופה."
            columns={[
              { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
              { key: "detail", label: "מזהה", render: (r) => <code dir="ltr" className="font-mono text-2xs text-rose-500">{r.detail}</code>, sort: (r) => r.detail },
              { key: "n", label: "הופעות", align: "end", bar: true, sort: (r) => r.n },
            ]}
          />
        </CollapsibleCard>
      </div>

      <CollapsibleCard
        id="ql-users"
        title="👤 שימוש לפי משתמש"
        summary={`${data.users.length} משתמשים רשומים פעילים`}
        hint="משתמשים רשומים בלבד. גלישה אנונימית נספרת בסקירה ואינה מקושרת לזהות. לחיצה על שורה טוענת את הפירוט של אותו משתמש בלבד — ולא של כולם מראש."
      >
        <AdminUserUsageTable rows={data.users} days={days} />
      </CollapsibleCard>

      <CollapsibleCard
        id="ql-raw"
        title="🗃️ פעילות גולמית"
        summary={`${data.events.length} סוגי אירועים`}
        hint="ספירת פעולות — לא אנשים. כולל גם את הגלישה שלך."
      >
        <DataTable<{ name: string; n: number }>
          rows={data.events}
          initialSort="n"
          csvName="events"
          columns={[
            { key: "name", label: "אירוע", render: (r) => <span dir="ltr" className="font-mono text-2xs">{r.name}</span>, sort: (r) => r.name },
            { key: "n", label: "פעמים", align: "end", bar: true, sort: (r) => r.n },
          ]}
        />
      </CollapsibleCard>
    </div>
  );
}
