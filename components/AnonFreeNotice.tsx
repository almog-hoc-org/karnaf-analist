import CtaLink from "@/components/CtaLink";

/**
 * The thin bar at the top of a city page a signed-out visitor opened on one of
 * their free slots.
 *
 * WHY IT EXISTS. The requirement was "no extra screen" — the visitor lands on
 * the full page and reads it. That is right, and it has one failure mode: the
 * allowance is spent invisibly, and the wall on the third city then arrives
 * with no warning and reads as a bait-and-switch. Someone who knows they are
 * on the second of two free cities is being offered something; someone who
 * finds out at the moment of refusal is being tricked.
 *
 * So: state the count, state that registering is free, and get out of the way.
 * One line, no dismiss button, no modal — anything larger would BE the extra
 * screen this whole feature exists to remove.
 *
 * NO CREDIT ARITHMETIC HERE. This bar used to add "and grants N credits for
 * opening more cities. The cities you already opened will be kept in the
 * account" — the same detail the wall itself was cut down to remove. Left in,
 * it would hand this visitor the full pitch one screen BEFORE the screen we
 * took it out of. What happens after an account exists can be read after it
 * exists.
 */
export default function AnonFreeNotice({
  used,
  limit,
  cityName,
}: {
  used: number;
  limit: number;
  cityName: string;
}) {
  const last = used >= limit;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-xs ${
        last ? "border-amber-200 bg-amber-50" : "border-indigo-100 bg-indigo-50/60"
      }`}
    >
      <p className="text-slate-700">
        <span aria-hidden className="me-1.5">{last ? "🔓" : "🎁"}</span>
        {last ? (
          <>
            זו העיר ה<b>{limit}</b> מתוך {limit} הפתוחות לך ללא הרשמה.
          </>
        ) : (
          <>
            עיר <b>{used}</b> מתוך <b>{limit}</b> שפתוחות לך ללא הרשמה.
          </>
        )}{" "}
        <span className="text-slate-500">
          ההרשמה <b className="text-slate-700">חינם ומהירה</b> — עם גוגל או מייל.
        </span>
      </p>
      <CtaLink
        href="/register"
        cta="register"
        context={`anon_free:${cityName}`}
        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-2xs font-black text-white transition-colors hover:bg-indigo-700"
      >
        להרשמה חינם
      </CtaLink>
    </div>
  );
}
