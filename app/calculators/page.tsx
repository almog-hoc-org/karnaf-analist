import Calculators from "@/components/Calculators";
import Icon from "@/components/Icon";

export const metadata = {
  title: "מחשבונים | קרנף אנליסט",
  description: "מחשבוני משכנתא, כדאיות השקעה, כדאיות שיפוץ וריבית דריבית — כלי תכנון מהירים לצד נתוני האמת.",
};

export default function CalculatorsPage() {
  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">
          <span className="text-gradient-hero"><Icon name="calculator" size="0.9em" /> מחשבונים</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          כלי תכנון מהירים — משכנתא, השקעה, שיפוץ וריבית דריבית. החישובים רצים אצלך בדפדפן;
          את ההנחות (מחירים, שכירויות) שווה לעגן בעסקאות האמת שבעמודי הערים.
        </p>
        <p className="mt-1.5 text-2xs text-slate-400">כלי עזר לתכנון בלבד · אינו מהווה ייעוץ השקעות או ייעוץ משכנתאות</p>
      </header>
      <Calculators />
    </main>
  );
}
