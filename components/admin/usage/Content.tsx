"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import DataTable from "@/components/admin/DataTable";
import PageName from "@/components/admin/PageName";
import { humanSeconds } from "@/components/AdminUserUsageTable";
import { labelForPath } from "@/lib/pageLabels";
import { type UsagePayload } from "@/lib/usagePayload";
import type { UsagePageRow, CityDemandRow, PathStep, LandingRow } from "@/lib/events";

/**
 * Which pages and which cities earn the attention.
 *
 * The card that cannot be replaced by any external tool is demand-versus-
 * coverage: it needs to know both what people looked at AND what is in the
 * archive, and no analytics product has the second half. "People keep opening
 * a city whose sample is thin" is a collection priority, and it is invisible
 * to anything that only sees traffic.
 */

type DemandRow = CityDemandRow & { quality: "thin" | "ok" | "partial" };

const QUALITY_HE: Record<DemandRow["quality"], string> = {
  thin: "מדגם דל", ok: "תקין", partial: "חלקי",
};

export default function Content({ data }: { data: UsagePayload }) {
  const starved = data.cities.filter((c) => c.quality === "thin" && c.views >= 5).length;

  return (
    <div className="space-y-3">
      <CollapsibleCard
        id="ct-cities" defaultOpen
        title="🏙️ ביקוש מול כיסוי"
        summary={`${data.cities.length} ערים${starved ? ` · ${starved} עם מדגם דל` : ""}`}
        hint="הערים הנצפות ביותר מוצלבות עם איכות הדאטה שלהן. זה המדד היחיד כאן שאף כלי אנליטיקה חיצוני לא יכול לייצר, כי הוא דורש לדעת גם מה במאגר וגם מה נצפה — ולכן הוא גם סדר העדיפויות לאיסוף."
      >
        <DataTable<DemandRow>
          rows={data.cities}
          initialSort="views"
          csvName="city-demand"
          maxRows={15}
          columns={[
            { key: "city", label: "עיר", render: (r) => <PageName path={`/city/${encodeURIComponent(r.city)}`} />, sort: (r) => r.city },
            { key: "views", label: "צפיות", align: "end", bar: true, sort: (r) => r.views },
            { key: "wallViews", label: "חשיפות חומה", align: "end", sort: (r) => r.wallViews },
            { key: "unlocks", label: "פתיחות", align: "end", sort: (r) => r.unlocks },
            {
              key: "quality", label: "כיסוי", align: "end",
              sort: (r) => r.quality, csv: (r) => QUALITY_HE[r.quality],
              render: (r) => (
                <span className={
                  r.quality === "thin" ? "font-bold text-amber-700"
                  : r.quality === "ok" ? "text-emerald-700" : "text-slate-400"
                }>{QUALITY_HE[r.quality]}</span>
              ),
            },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="ct-pages" defaultOpen
        title="📄 עמודים"
        summary={`${data.pages.length} עמודים`}
        hint="זמן ממוצע לצפייה נמדד רק כשהלשונית גלויה, ועם תקרה של 30 דקות לצפייה — כדי שלשונית שנשכחה פתוחה בן לילה לא תיכנס לממוצע."
      >
        <DataTable<UsagePageRow>
          rows={data.pages}
          initialSort="views"
          csvName="pages"
          maxRows={15}
          columns={[
            { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
            { key: "views", label: "צפיות", align: "end", bar: true, sort: (r) => r.views },
            { key: "avgSeconds", label: "זמן ממוצע", align: "end", sort: (r) => r.avgSeconds, render: (r) => humanSeconds(r.avgSeconds) },
            { key: "totalSeconds", label: "סה״כ זמן", align: "end", sort: (r) => r.totalSeconds, render: (r) => humanSeconds(r.totalSeconds) },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="ct-paths"
        title="🧭 מסלולי ניווט"
        summary={`${data.paths.length} מעברים`}
        hint="זו השאלה שטבלת היציאות לא עונה עליה: יציאה אומרת שהביקור נגמר, וזה אומר מה הביקור עשה במקום. אם הצעד הנפוץ אחרי עמוד עיר הוא חזרה לעמוד הבית ולא מעבר להשוואה או לבדיקת מחיר — הצעד הבא הטבעי לא קיים או לא נראה משם."
      >
        <DataTable<PathStep>
          rows={data.paths}
          initialSort="n"
          csvName="navigation-paths"
          maxRows={12}
          columns={[
            { key: "from", label: "מ", render: (r) => <span className="truncate text-slate-600">{labelForPath(r.from).label}</span>, sort: (r) => labelForPath(r.from).label },
            { key: "to", label: "אל", render: (r) => <span className="truncate font-semibold text-slate-800">{labelForPath(r.to).label}</span>, sort: (r) => labelForPath(r.to).label },
            { key: "n", label: "מעברים", align: "end", bar: true, sort: (r) => r.n },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="ct-landings"
        title="🛬 עמודי נחיתה"
        summary={`${data.landings.length} עמודי כניסה`}
        hint="נטישה = ביקור שראה עמוד אחד ועזב תוך פחות מ-10 שניות. עמוד שמביא תנועה שלא נשארת הוא בעיה של התאמה בין ההבטחה לתוכן."
      >
        <DataTable<LandingRow>
          rows={data.landings}
          initialSort="sessions"
          csvName="landings"
          maxRows={12}
          columns={[
            { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
            { key: "sessions", label: "ביקורים", align: "end", bar: true, sort: (r) => r.sessions },
            {
              key: "bounceRatePct", label: "% נטישה", align: "end", sort: (r) => r.bounceRatePct,
              render: (r) => <span className={r.bounceRatePct >= 70 ? "font-bold text-rose-600" : ""}>{r.bounceRatePct}%</span>,
            },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="ct-search" defaultOpen
        title="🔎 חיפושים"
        summary={`${data.misses.length} מונחים ללא תוצאה`}
        hint="חיפוש שלא מצא כלום הוא גולש שביקש משהו שאיננו מכסים — או שמאייתים אצלנו אחרת. זו רשימת המשימות הזולה ביותר שיש, כי כל שורה בה היא ביקוש מוכח."
      >
        <DataTable<{ term: string; n: number; misses: number }>
          rows={data.searches}
          initialSort="n"
          csvName="searches"
          maxRows={15}
          columns={[
            { key: "term", label: "מונח", sort: (r) => r.term },
            { key: "n", label: "חיפושים", align: "end", bar: true, sort: (r) => r.n },
            {
              key: "misses", label: "ללא תוצאה", align: "end", sort: (r) => r.misses,
              render: (r) => <span className={r.misses > 0 ? "font-bold text-rose-600" : "text-slate-300"}>{r.misses || "—"}</span>,
            },
          ]}
        />
      </CollapsibleCard>
    </div>
  );
}
