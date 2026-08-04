import BrandMark from "./BrandMark";
import { BRAND, whatsappUrl } from "@/lib/brand";

/**
 * The one commercial call to action on the site: the course, and a way to talk
 * to a person.
 *
 * WHERE THIS GOES, AND WHY NOT HIGHER
 * At the BOTTOM of the home page and in the footer — never above the research,
 * and never on a city page. What distinguishes this site from madlan and yad2
 * is that it reads as a research tool rather than a funnel; a visitor who meets
 * a pitch before a number has already been told which of those it is. Selling
 * after the work has been shown costs nothing and keeps that intact.
 *
 * The WhatsApp link sits beside it deliberately. A reader who does not want a
 * course may still have a question, and giving only the paid path makes the
 * whole block read as an advertisement rather than as a way to reach us.
 */
export default function CourseBanner({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs">
        <a
          href={BRAND.courseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-indigo-700 hover:underline"
        >
          הקורס המקיף של {BRAND.name} ←
        </a>
        <span aria-hidden className="text-slate-300">·</span>
        <a
          href={whatsappUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline"
        >
          <span aria-hidden>💬</span>
          וואטסאפ {BRAND.whatsapp.display}
        </a>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="course-cta"
      className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-indigo-50/40 px-5 py-6 shadow-sm md:px-8 md:py-7"
    >
      <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-center md:gap-7 md:text-start">
        <BrandMark size={88} className="drop-shadow-sm" />

        <div className="flex-1">
          <h2 id="course-cta" className="text-lg font-black text-slate-900 md:text-xl">
            רוצה להבין מה עומד מאחורי המספרים?
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            הכלי הזה מראה <strong className="text-slate-900">מה</strong> קורה בשוק.
            הקורס המקיף של {BRAND.name} מלמד <strong className="text-slate-900">איך לקרוא את זה</strong>{" "}
            ולקבל החלטה — ניתוח עסקה, בדיקת כדאיות, ומה באמת משפיע על מחיר.
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 md:w-auto">
          <a
            href={BRAND.courseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-center text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            לקורס המקיף
          </a>
          <a
            href={whatsappUrl("היי, הגעתי מקרנף אנליסט ויש לי שאלה")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-5 py-2.5 text-sm font-bold text-emerald-800 transition-colors hover:bg-emerald-50"
          >
            <span aria-hidden>💬</span>
            שאלה בוואטסאפ
          </a>
        </div>
      </div>
    </section>
  );
}
