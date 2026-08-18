"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { track } from "@/lib/track";

/**
 * ★ follow a city.
 *
 * `tracked_cities` has existed since the first version of the app and was
 * reachable from exactly one screen — the private /deals workspace — so the
 * only people who could follow a city were the ones who had already committed
 * to using the deal tracker. Everyone else read a city page, closed the tab,
 * and had no reason to return.
 *
 * The button is optimistic: the star fills the moment it is pressed and only
 * reverts if the server disagrees. A follow is a small, reversible, obviously
 * safe action, and making the reader wait on a round trip to see it register is
 * the surest way to make them press it twice.
 */
export default function TrackCityButton({
  cityName,
  initiallyTracked,
  signedIn,
  action,
}: {
  cityName: string;
  initiallyTracked: boolean;
  signedIn: boolean;
  /** server action — returns the resulting state so an optimistic flip can be corrected */
  action: (city: string, next: boolean) => Promise<boolean>;
}) {
  const [tracked, setTracked] = useState(initiallyTracked);
  const [pending, start] = useTransition();

  if (!signedIn) {
    return (
      <a
        href={`/login?next=${encodeURIComponent(`/city/${encodeURIComponent(cityName)}`)}`}
        onClick={() => track("follow_city_click", { subject: cityName, detail: "login_required" })}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
        title="התחברו כדי לעקוב אחרי העיר ולקבל עדכון כשמשהו זז"
      >
        <span aria-hidden>☆</span> עקבו אחרי {cityName}
      </a>
    );
  }

  const toggle = () => {
    const next = !tracked;
    track("follow_city_click", { subject: cityName, detail: next ? "follow" : "unfollow" });
    setTracked(next); // optimistic
    start(async () => {
      try {
        setTracked(await action(cityName, next));
      } catch {
        setTracked(!next); // the server said otherwise
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={tracked}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
        tracked
          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700"
      }`}
      title={tracked ? `הפסיקו לעקוב אחרי ${cityName}` : `עקבו אחרי ${cityName} וקבלו סיכום שבועי`}
    >
      <span aria-hidden>{tracked ? "★" : "☆"}</span>
      {tracked ? "במעקב" : `עקבו אחרי ${cityName}`}
      {tracked && <Icon name="check" size="0.9em" />}
    </button>
  );
}
