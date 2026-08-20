"use client";

import { useEffect } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { track } from "@/lib/track";

/**
 * Route-level error boundary.
 *
 * The failure this is written for is specific: the site reads a 300MB SQLite
 * file that a nightly pipeline rewrites, so a page render CAN throw for
 * reasons that have nothing to do with the visitor and everything to do with
 * timing. Without this file that visitor saw Next's raw error screen — a
 * stack-trace-shaped page, in English, with the site's chrome gone.
 *
 * reset() re-renders the segment. For a transient DB error that is usually
 * enough, which is why "נסה שוב" is the primary action rather than a link home.
 *
 * The error is logged to the console so it lands in the container's log
 * (docker compose logs app) — the only error sink this deployment has today.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page-error]", error.digest ?? "", error.message, error.stack);
    // Also recorded as an event, because the container log answers "what broke"
    // and this answers "how many people hit it, and on which page". When Migdal
    // HaEmek was throwing, the only reason anyone knew was that the operator
    // happened to click it — a visitor who met the same screen left no trace.
    // The digest only: never the message, which can carry internals.
    track("error_shown", { detail: error.digest ?? "no-digest" });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl" aria-hidden><Icon name="warning" size="1em" /></p>
      <h1 className="mt-4 text-2xl font-black text-slate-900">משהו השתבש בטעינת העמוד</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        לרוב זו תקלה רגעית — הנתונים מתעדכנים ברקע כל לילה. אפשר לנסות שוב;
        אם זה חוזר, נשמח לדעת דרך כפתור המשוב.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          נסה שוב
        </button>
        <Link href="/" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          לעמוד הראשי
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 text-2xs text-slate-400">
          מזהה תקלה: <code dir="ltr" className="font-mono">{error.digest}</code>
        </p>
      )}
    </main>
  );
}
