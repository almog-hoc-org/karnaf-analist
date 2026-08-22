import { labelForPath, sectionLabel } from "./pageLabels";
import { share, type UsagePayload } from "./usagePayload";

/**
 * From numbers to decisions.
 *
 * The dashboard shows the right measures, ordered by importance, compared to
 * the period before. What it still does not do is say WHAT TO DO. "34%
 * returning" is a number; whether that is good, and what to change if it is
 * not, was left to the reader — which is the work a dashboard exists to save.
 *
 * A PURE FUNCTION OVER A PLAIN OBJECT, on purpose. No database, no React, no
 * fetch. That is what makes it testable, and testability matters more here
 * than almost anywhere else in this codebase: a wrong insight is worse than no
 * insight, because it arrives phrased as advice and gets acted on.
 *
 * EVERY THRESHOLD CARRIES ITS REASON. Where an accepted benchmark exists it is
 * used and named (Google's p75 Web Vitals limits, GA4's engaged-session
 * definition, the 20% DAU/WAU line); where none exists the number is written
 * with the argument for it. A rule that fires on a feeling teaches the reader
 * to distrust the whole board.
 *
 * THE 85/15 MIX (operator, 8/2026). Seven improvements to one thing worth
 * keeping. A board made of good news becomes decoration; a board made only of
 * alarms loses the thing you must not break while fixing something else. The
 * "keep" card is not a compliment — it is "this works, do not disturb it".
 *
 * SILENCE IS A VALID OUTPUT. On a site with no traffic every ratio is 0/0, and
 * a rule that announces "0% conversion!" to an empty log is exactly how a board
 * loses its credibility in week one. Each rule states its own minimum evidence
 * and returns nothing below it.
 */

export type InsightTab = "overview" | "conversion" | "engagement" | "content" | "quality";

export interface Insight {
  id: string;
  kind: "fix" | "keep";
  /** 3 = act now · 2 = worth a look · 1 = context */
  severity: 1 | 2 | 3;
  /** the number that is the real headline of the card */
  metric: string;
  title: string;
  /** what it means — the interpretation the reader would otherwise supply */
  meaning: string;
  /** what to do about it */
  action: string;
  /** the counts behind the claim, so it can be checked rather than believed */
  evidence?: string;
  /** which tab shows this in full */
  tab?: InsightTab;
  /** or which page of the site to go and look at */
  href?: string;
  /** internal ranking weight — bigger is more consequential */
  weight: number;
}

/**
 * Google's Core Web Vitals thresholds, at p75.
 *
 * Exported so the Quality tab and this engine cannot disagree about what
 * "slow" means. CLS is stored ×1000 (see lib/track.ts) because a ratio around
 * 0.1 would round to zero as an integer.
 */
export const VITAL_LIMITS: Record<string, { good: number; poor: number; unit: string; what: string }> = {
  LCP: { good: 2500, poor: 4000, unit: "ms", what: "מתי התוכן הראשי הופיע" },
  INP: { good: 200, poor: 500, unit: "ms", what: "כמה מהר הגיב ללחיצה" },
  FCP: { good: 1800, poor: 3000, unit: "ms", what: "מתי משהו ראשון הופיע" },
  TTFB: { good: 800, poor: 1800, unit: "ms", what: "כמה זמן לקח לשרת לענות" },
  CLS: { good: 100, poor: 250, unit: "", what: "כמה הפריסה קפצה בטעינה" },
};

/**
 * Minimum evidence before ANY rule may speak.
 *
 * Twenty visits is not a sample; it is an afternoon. Below it every percentage
 * swings on one person's behaviour, and advice derived from that is noise
 * wearing the costume of analysis.
 */
const MIN_SESSIONS = 20;

/** A page needs this many views before its exit rate means anything. */
const MIN_PAGE_VIEWS = 8;

const secs = (s: number) => (s < 60 ? `${s} שנ׳` : `${Math.round(s / 60)} דק׳`);

export function buildUsageInsights(d: UsagePayload): Insight[] {
  const out: Insight[] = [];
  const sessions = d.shape?.sessions ?? 0;
  const quiet = sessions < MIN_SESSIONS;

  const push = (i: Insight) => out.push(i);

  /* ── activation and conversion ─────────────────────────────────────────── */

  if (d.neverUnlocked > 0) {
    push({
      id: "never-unlocked", kind: "fix", severity: 3, weight: 100 + d.neverUnlocked * 5,
      metric: `${d.neverUnlocked}`,
      title: "חשבונות שנרשמו ולא פתחו אף עיר",
      meaning: "הם עברו את השלב הקשה — נתנו מייל — ואז לא הגיעו לערך. היתרה שלהם יושבת ללא שימוש, וחשבון שלא הגיע לערך בפעם הראשונה כמעט אף פעם לא חוזר לנסות.",
      action: "לשלוח להם מייל אחד עם קישור ישיר לעיר אחת פתוחה, או לפתוח להם עיר ראשונה אוטומטית בהרשמה כדי שיראו מה יש בפנים.",
      evidence: `מתוך ${d.funnel.find((f) => f.key === "registered")?.n ?? 0} שנרשמו בתקופה`,
      tab: "conversion",
    });
  }

  // The steepest drop in the funnel — where a fix multiplies through every
  // stage after it, which is why it outranks a bigger loss further down.
  if (!quiet && d.funnel.length > 1) {
    let worstIdx = -1, worstLoss = 0;
    for (let i = 1; i < d.funnel.length; i++) {
      const loss = d.funnel[i - 1].n - d.funnel[i].n;
      if (loss > worstLoss) { worstLoss = loss; worstIdx = i; }
    }
    if (worstIdx > 0 && worstLoss > 0 && d.funnel[worstIdx].ofPreviousPct < 60) {
      const from = d.funnel[worstIdx - 1], to = d.funnel[worstIdx];
      push({
        id: "funnel-drop", kind: "fix", severity: 3, weight: 95 + worstLoss / 10,
        metric: `${100 - to.ofPreviousPct}%`,
        title: `הנשירה הגדולה: ${from.label} ← ${to.label}`,
        meaning: `${worstLoss.toLocaleString("he-IL")} נשרו בין שני השלבים האלה. זה השלב הכי יקר במשפך, כי כל מי שנופל כאן נופל גם מכל השלבים שאחריו.`,
        action: "לתקן דווקא כאן ולא בשלב אחר — שיפור של עשרה אחוזים בשלב הזה שווה יותר משיפור של עשרה אחוזים בכל שלב אחר במשפך.",
        evidence: `${from.n.toLocaleString("he-IL")} → ${to.n.toLocaleString("he-IL")}`,
        tab: "conversion",
      });
    }
  }

  // A day is the line: an account that reaches value in the same sitting
  // behaves very differently from one that has to come back and try again.
  if (d.ttfv.medianMinutes != null && d.ttfv.n >= 3 && d.ttfv.medianMinutes > 1440) {
    push({
      id: "slow-ttfv", kind: "fix", severity: 2, weight: 70,
      metric: `${(d.ttfv.medianMinutes / 1440).toFixed(1)} ימים`,
      title: "זמן חציוני מהרשמה לפתיחת עיר ראשונה",
      meaning: "הערך רחוק מדי מרגע ההרשמה. מי שנרשם ולא ראה תוצאה באותה ישיבה צריך לחזור ביוזמתו — ורובם לא.",
      action: "לקצר את המרחק: לפתוח עיר ראשונה בהרשמה, או להנחית את הנרשם ישירות על העיר שבגללה הוא נרשם במקום על עמוד הבית.",
      evidence: `${d.ttfv.within24hPct}% הגיעו תוך יממה · ${d.ttfv.n} חשבונות`,
      tab: "conversion",
    });
  }

  // Traffic that brings nobody. Needs enough sessions that zero is a finding
  // and not an accident of a small denominator.
  const deadLanding = d.landingConversion
    .filter((l) => l.sessions >= 15 && l.convPct === 0)
    .sort((a, b) => b.sessions - a.sessions)[0];
  if (deadLanding) {
    push({
      id: "landing-no-conversion", kind: "fix", severity: 2, weight: 60 + deadLanding.sessions / 5,
      metric: "0%",
      title: `${labelForPath(deadLanding.path).label} — מביא תנועה ואפס משתמשים`,
      meaning: `${deadLanding.sessions} ביקורים נכנסו דרך העמוד הזה ואף אחד מהם לא הפך לחשבון. או שהוא מביא אנשים שלא חיפשו את מה שיש כאן, או שההבטחה שלו לא מתקיימת בעמוד עצמו.`,
      action: "להשוות בין מה שמבטיח המקור שמפנה לעמוד לבין מה שהעמוד מציג, ולהוסיף לו קריאה לפעולה שמובילה למשהו שאפשר לפתוח.",
      href: deadLanding.path,
      tab: "conversion",
    });
  }

  // A currency nobody spends is not a currency.
  if (d.credits.granted >= 50) {
    const used = share(d.credits.spent, d.credits.granted);
    if (used < 30) {
      push({
        id: "credits-idle", kind: "fix", severity: 2, weight: 55,
        metric: `${used}%`,
        title: "שיעור ניצול הקרדיטים",
        meaning: "הוענקו הרבה קרדיטים ומעטים נוצלו. מטבע שלא מוציאים אותו לא מניע פעולה — או שהוא נדיב מדי מכדי שיהיה לו ערך, או שלא ברור מה עושים איתו.",
        action: "להציג את היתרה במקום שרואים אותו, ולהצמיד לה משפט אחד שאומר מה אפשר לפתוח בה עכשיו.",
        evidence: `${d.credits.granted} הוענקו · ${d.credits.spent} נוצלו · ${d.credits.outstanding} יושבים אצל ${d.credits.usersWithBalance} חשבונות`,
        tab: "conversion",
      });
    }
  }

  /* ── friction and quality ──────────────────────────────────────────────── */

  const deadEnd = d.exits
    .filter((e) => e.views >= MIN_PAGE_VIEWS && e.exitRatePct >= 60 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20)
    .sort((a, b) => b.exits - a.exits)[0];
  if (deadEnd) {
    push({
      id: "dead-end", kind: "fix", severity: 3, weight: 90 + deadEnd.exits,
      metric: `${deadEnd.exitRatePct}%`,
      title: `מבוי סתום: ${labelForPath(deadEnd.path).label}`,
      meaning: `${deadEnd.exits} ביקורים הסתיימו כאן אחרי ${secs(deadEnd.avgSecondsBeforeExit)} בלבד. יציאה גבוהה לבדה היא בסדר — העמוד האחרון של ביקור מוצלח הוא גם יציאה — אבל יציאה גבוהה עם שהייה קצרה אומרת שהגיעו, הסתכלו, ועזבו.`,
      action: "לפתוח את העמוד ולשאול מה הצעד הבא הטבעי ממנו. אם אין כזה, להוסיף אותו.",
      href: deadEnd.path,
      tab: "quality",
    });
  }

  const errorTotal = d.errors.reduce((s, e) => s + e.n, 0);
  if (errorTotal > 0) {
    const worst = [...d.errors].sort((a, b) => b.n - a.n)[0];
    push({
      id: "errors", kind: "fix", severity: 3, weight: 110 + errorTotal * 3,
      metric: `${errorTotal}`,
      title: "מסכי שגיאה שגולשים ראו",
      meaning: "אלו לא שגיאות בלוג — אלו אנשים שראו מסך שבור. כמעט אף אחד מהם לא מדווח; הם פשוט עוזבים ולא חוזרים.",
      action: `לחפש את המזהה ${worst.detail} בלוג של הקונטיינר, לתקן, ולוודא שהמונה חוזר לאפס בפריסה הבאה.`,
      evidence: `${d.errors.length} סוגים · הנפוץ ב${labelForPath(worst.path).label}`,
      tab: "quality",
    });
  }

  const slowVital = d.vitals
    .filter((v) => VITAL_LIMITS[v.metric] && v.p75 > VITAL_LIMITS[v.metric].poor && v.n >= 5)
    .sort((a, b) => (b.p75 / VITAL_LIMITS[b.metric].poor) - (a.p75 / VITAL_LIMITS[a.metric].poor))[0];
  if (slowVital) {
    const lim = VITAL_LIMITS[slowVital.metric];
    const mobile = slowVital.device === "mobile";
    push({
      id: "slow-page", kind: "fix", severity: mobile ? 3 : 2, weight: (mobile ? 85 : 65) + slowVital.n,
      metric: slowVital.metric === "CLS" ? (slowVital.p75 / 1000).toFixed(2) : `${(slowVital.p75 / 1000).toFixed(1)} שנ׳`,
      title: `${labelForPath(slowVital.path).label} איטי${mobile ? " במובייל" : ""}`,
      meaning: `${slowVital.metric} — ${lim.what} — עומד על ${slowVital.p75}${lim.unit} אצל רבע מהגולשים, מול סף של ${lim.poor}${lim.unit} שמעליו גוגל מגדירה את החוויה כגרועה.${mobile ? " בטלפון זו נטישה שלא מופיעה בשום מדד אחר: הם עוזבים לפני שנספרה צפייה." : ""}`,
      action: "לבדוק מה נטען בעמוד הזה לפני התוכן הראשי — תמונה גדולה, גרף כבד, או שאילתה שמחזיקה את הרינדור.",
      evidence: `${slowVital.n} מדידות · p75`,
      href: slowVital.path,
      tab: "quality",
    });
  }

  const rage = [...d.rage].sort((a, b) => b.n - a.n)[0];
  if (rage && rage.n >= 2) {
    push({
      id: "rage", kind: "fix", severity: 2, weight: 50 + rage.n * 4,
      metric: `×${rage.n}`,
      title: `לחיצות זעם על "${rage.label}"`,
      meaning: "שלוש לחיצות ומעלה על אותו אלמנט תוך שנייה וחצי, בלי שקרה כלום. משהו שם נראה לחיץ ואינו — או שהוא לחיץ ולא מגיב מספיק מהר כדי שיאמינו לו.",
      action: "לפתוח את העמוד, ללחוץ על האלמנט, ולראות מה קורה. אם הוא לא אמור להיות לחיץ — להוריד ממנו את המראה הזה.",
      evidence: `ב${labelForPath(rage.path).label}`,
      href: rage.path,
      tab: "quality",
    });
  }

  /* ── engagement and retention ──────────────────────────────────────────── */

  // GA4's own line for a healthy site sits around 55–60% engaged sessions.
  if (!quiet && d.engagement.sessions >= MIN_SESSIONS && d.engagement.engagedPct < 55) {
    push({
      id: "low-engagement", kind: "fix", severity: 2, weight: 75,
      metric: `${d.engagement.engagedPct}%`,
      title: "ביקורים מעורבים",
      meaning: `רק ${d.engagement.engagedPct}% מהביקורים עברו עשר שניות, או ראו שני עמודים, או עשו פעולה. כלומר רוב המבקרים לא הגיעו לתוכן בכלל — הם נחתו, הסתכלו, ויצאו.`,
      action: "לבדוק את עמודי הנחיתה המובילים: מה רואים בהם בשלוש השניות הראשונות, והאם זה מה שהמבקר חיפש.",
      evidence: `${d.engagement.engaged} מתוך ${d.engagement.sessions} ביקורים`,
      tab: "content",
    });
  }

  if (!quiet && d.visitors.visitors >= 30 && d.visitors.returningPct < 20) {
    push({
      id: "low-return", kind: "fix", severity: 2, weight: 80,
      metric: `${d.visitors.returningPct}%`,
      title: "מבקרים חוזרים",
      meaning: "כמעט כל מי שמגיע מגיע פעם אחת. זה דלי מחורר: תנועה נכנסת ולא נשארת, וכל גידול בתנועה יעלה כסף בכל פעם מחדש.",
      action: "לתת סיבה לחזור — מעקב אחרי עיר עם עדכון כשמשהו זז בה, או הדיוור השבועי. שימור זול פי כמה מרכישה.",
      evidence: `${d.visitors.returning} מתוך ${d.visitors.visitors} מבקרים`,
      tab: "engagement",
    });
  }

  // Most visitors touching zero features means the site is being read like an
  // article rather than used like a tool.
  const passive = d.adoption.find((b) => b.bucket === "צפייה בלבד");
  const adoptTotal = d.adoption.reduce((s, b) => s + b.n, 0);
  if (!quiet && passive && adoptTotal >= MIN_SESSIONS && share(passive.n, adoptTotal) > 60) {
    push({
      id: "passive-use", kind: "fix", severity: 2, weight: 58,
      metric: `${share(passive.n, adoptTotal)}%`,
      title: "מבקרים שלא נגעו באף כלי",
      meaning: "רוב המבקרים רק קראו — לא חיפשו, לא השוו, לא פתחו גרף ולא עקבו אחרי עיר. האתר נצרך כמו מאמר ולא כמו כלי, ומאמר קוראים פעם אחת.",
      action: "להציב את הפעולה הראשונה גבוה יותר בעמוד — חיפוש עיר או השוואה — במקום להשאיר אותה למי שגולל.",
      evidence: `${passive.n} מתוך ${adoptTotal}`,
      tab: "engagement",
    });
  }

  // Content below the fold that nobody reaches.
  const shallow = d.depth
    .filter((p) => p.views >= MIN_PAGE_VIEWS && p.medianPct < 40 && p.foldPct < 30)
    .sort((a, b) => b.views - a.views)[0];
  if (shallow) {
    push({
      id: "below-fold", kind: "fix", severity: 2, weight: 52 + shallow.views / 4,
      metric: `${shallow.medianPct}%`,
      title: `${labelForPath(shallow.path).label} — הקורא החציוני עוצר כאן`,
      meaning: `המסך הראשון מראה ${shallow.foldPct}% מהעמוד, והקורא החציוני מגיע ל-${shallow.medianPct}%. כל מה שמתחת לזה קיים בפועל רק למיעוט.`,
      action: "להעלות למעלה את הדבר שבגללו נכנסו לעמוד, ולדחוף למטה את מה שהוא רקע.",
      evidence: `${shallow.views} צפיות`,
      href: shallow.path,
      tab: "engagement",
    });
  }

  const buried = d.sections
    .filter((s) => s.reachPct > 0 && s.reachPct < 15 && s.views >= 3)
    .sort((a, b) => a.reachPct - b.reachPct)[0];
  if (buried) {
    push({
      id: "buried-section", kind: "fix", severity: 1, weight: 35,
      metric: `${buried.reachPct}%`,
      title: `"${sectionLabel(buried.section)}" — כמעט אף אחד לא מגיע`,
      meaning: "החלק הזה בעמוד העיר נצפה במיעוט קטן מהביקורים. או שהוא קבור עמוק מדי בעמוד, או שהוא לא מה שאנשים באו בשבילו.",
      action: "להחליט אחד משניים: להעלות אותו למעלה, או להוריד אותו ולהחזיר את המקום למה שכן נקרא.",
      evidence: `${buried.views} צפיות · ${secs(buried.avgSeconds)} בממוצע`,
      tab: "engagement",
    });
  }

  /* ── content and demand ────────────────────────────────────────────────── */

  const starved = d.cities
    .filter((c) => c.quality === "thin" && c.views >= 3)
    .sort((a, b) => b.views - a.views)[0];
  if (starved) {
    push({
      id: "starved-city", kind: "fix", severity: 2, weight: 68 + starved.views,
      metric: `${starved.views}`,
      title: `${starved.city} — ביקוש גבוה, מדגם דל`,
      meaning: "אנשים נכנסים לעיר הזו שוב ושוב ומקבלים דאטה חלשה. זה המקום היחיד שבו אפשר לדעת בוודאות שהשלמת איסוף תשרת מישהו — כי הוא כבר ביקש.",
      action: "להריץ איסוף ממוקד על העיר הזו לפני ערים שאין עליהן ביקוש מוכח.",
      evidence: `${starved.wallViews} חשיפות חומה · ${starved.unlocks} פתיחות`,
      href: `/city/${encodeURIComponent(starved.city)}`,
      tab: "content",
    });
  }

  const miss = d.misses[0];
  if (miss && miss.n >= 2) {
    push({
      id: "failed-search", kind: "fix", severity: 2, weight: 45 + miss.n * 3,
      metric: `×${miss.n}`,
      title: `חיפשו "${miss.term}" ולא מצאו`,
      meaning: "ביקוש מוכח בלי מענה. או שהיישוב לא במאגר, או שהוא נכתב אצלנו בכתיב אחר ממה שאנשים מקלידים.",
      action: "לבדוק אם השם קיים במאגר תחת כתיב אחר — ואם כן, להוסיף אותו לטבלת הכינויים. אם לא, זו עיר להוסיף.",
      tab: "content",
    });
  }

  // One source carrying the audience is a single point of failure.
  const srcTotal = d.sources.reduce((s, x) => s + x.sessions, 0);
  const topSrc = d.sources[0];
  if (topSrc && srcTotal >= MIN_SESSIONS && share(topSrc.sessions, srcTotal) > 70 && topSrc.source !== "direct") {
    push({
      id: "source-concentration", kind: "fix", severity: 1, weight: 40,
      metric: `${share(topSrc.sessions, srcTotal)}%`,
      title: `כמעט כל התנועה מ-${topSrc.source}`,
      meaning: "ריכוז כזה הוא שבריריות: שינוי אחד באלגוריתם או במדיניות של המקור הזה מוחק את רוב הקהל בלי התראה.",
      action: "לפתוח ערוץ שני — דיוור, שיתוף, או תוכן שמביא תנועה ישירה — עוד לפני שיש בעיה.",
      evidence: `${topSrc.sessions} מתוך ${srcTotal} ביקורים`,
      tab: "overview",
    });
  }

  /* ── what is working, and must not be broken ───────────────────────────── */

  if (!quiet && d.engagement.engagedPct >= 70) {
    push({
      id: "keep-engagement", kind: "keep", severity: 1, weight: 30,
      metric: `${d.engagement.engagedPct}%`,
      title: "ביקורים מעורבים — מעל הסף המקובל",
      meaning: "רוב גדול מהמבקרים מגיע לתוכן ולא רק נוחת ועוזב. זה גבוה מהטווח שנחשב בריא (55–60%).",
      action: "לשמור על מה שמייצר את זה: עמודי הנחיתה המובילים והמהירות שלהם. שינוי בהם הוא הסיכון האמיתי.",
      tab: "content",
    });
  }

  const strongCohort = d.cohorts.filter((c) => c.signups >= 3).sort((a, b) => share(b.d7, b.signups) - share(a.d7, a.signups))[0];
  if (strongCohort && share(strongCohort.d7, strongCohort.signups) >= 40) {
    push({
      id: "keep-cohort", kind: "keep", severity: 1, weight: 32,
      metric: `${share(strongCohort.d7, strongCohort.signups)}%`,
      title: `קוהורטת ${strongCohort.week} חזרה תוך שבוע`,
      meaning: "שיעור חזירה גבוה בקוהורטה שלמה — לא ממוצע שממוסך על ידי חודש טוב אחד. מי שנרשם באותו שבוע מצא סיבה לחזור.",
      action: "לבדוק מה היה שונה באותו שבוע — מאיפה הגיעו, לאיזה עמוד נחתו — ולנסות לשחזר את זה.",
      evidence: `${strongCohort.signups} נרשמו`,
      tab: "engagement",
    });
  }

  if (!quiet && errorTotal === 0 && d.rage.length === 0) {
    push({
      id: "keep-clean", kind: "keep", severity: 1, weight: 25,
      metric: "0",
      title: "אף גולש לא נתקל בשגיאה או באלמנט שבור",
      meaning: "לא מסכי שגיאה ולא לחיצות זעם בכל התקופה. באתר שקורא מסד נתונים שנכתב מחדש כל לילה זו לא מובנת מאליה.",
      action: "לשמור על כך: הפרוב שרץ בכל פריסה על 168 עמודי הערים הוא מה שתופס את זה לפני שגולש תופס.",
      tab: "quality",
    });
  }

  const fastVitals = d.vitals.filter((v) => VITAL_LIMITS[v.metric] && v.p75 <= VITAL_LIMITS[v.metric].good);
  if (fastVitals.length >= 3 && !slowVital) {
    push({
      id: "keep-speed", kind: "keep", severity: 1, weight: 22,
      metric: "✓",
      title: "המהירות בטווח הירוק בכל המדידות",
      meaning: "כל מדדי הליבה עומדים בסף הטוב של גוגל ב-p75, כלומר גם רבע הגולשים האיטיים חווים אתר מהיר.",
      action: "לבדוק את זה שוב אחרי כל תוספת כבדה לעמוד — גרף, תמונה או ספרייה חדשה.",
      evidence: `${fastVitals.length} מדידות בירוק`,
      tab: "quality",
    });
  }

  const goodLanding = d.landingConversion.filter((l) => l.sessions >= 10 && l.convPct >= 20)
    .sort((a, b) => b.convPct - a.convPct)[0];
  if (goodLanding) {
    push({
      id: "keep-landing", kind: "keep", severity: 1, weight: 28,
      metric: `${goodLanding.convPct}%`,
      title: `${labelForPath(goodLanding.path).label} ממיר היטב`,
      meaning: "עמוד הכניסה הזה הופך חלק גבוה מהמבקרים לחשבונות. הוא עושה משהו נכון שהעמודים האחרים לא.",
      action: "להסתכל מה יש בו ולהעתיק את זה לעמודי הכניסה האחרים — במיוחד לאלה שמביאים תנועה ולא ממירים.",
      evidence: `${goodLanding.converted} מתוך ${goodLanding.sessions}`,
      href: goodLanding.path,
      tab: "conversion",
    });
  }

  const wellCovered = d.cities.filter((c) => c.quality === "ok" && c.views >= 5)
    .sort((a, b) => b.views - a.views)[0];
  if (wellCovered && !starved) {
    push({
      id: "keep-coverage", kind: "keep", severity: 1, weight: 20,
      metric: `${wellCovered.views}`,
      title: `${wellCovered.city} — ביקוש גבוה וכיסוי מלא`,
      meaning: "העיר הנצפית ביותר היא גם אחת שהדאטה בה שלמה. זה המצב שכל עיר אמורה להיות בו.",
      action: "לשמור על טריות האיסוף בערים המובילות — הן שנותנות את הרושם הראשון.",
      tab: "content",
    });
  }

  return out;
}

/**
 * Rank, then enforce the 85/15 mix.
 *
 * Sorting by severity and then by weight is the easy half. The hard half is
 * that a naive "top 8" on a healthy site fills with "keep" cards and the board
 * stops being useful — and on a broken site it fills with alarms and the
 * operator loses sight of what must not be disturbed. So the split is applied
 * before the cut, not after it.
 *
 * If one side is short, the other does NOT expand to fill the gap: a padded
 * board is a board with weak items in it, and one weak recommendation costs
 * more trust than three good ones earn.
 */
export function rankInsights(all: Insight[], limit = 8): { shown: Insight[]; rest: Insight[] } {
  const byRank = (a: Insight, b: Insight) => b.severity - a.severity || b.weight - a.weight;
  const fixes = all.filter((i) => i.kind === "fix").sort(byRank);
  const keeps = all.filter((i) => i.kind === "keep").sort(byRank);

  const keepSlots = Math.max(1, Math.round(limit * 0.15)); // 8 → 1, 14 → 2
  const fixSlots = limit - keepSlots;

  const shown = [...fixes.slice(0, fixSlots), ...keeps.slice(0, keepSlots)];
  const shownIds = new Set(shown.map((i) => i.id));
  const rest = [...fixes, ...keeps].filter((i) => !shownIds.has(i.id));
  return { shown, rest };
}
