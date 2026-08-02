"use client";

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { getViewState } from "@/lib/viewState";
import { track } from "@/lib/track";
import { FEEDBACK_KINDS, KIND_LABELS, type FeedbackKind } from "@/lib/feedbackTypes";

/**
 * Floating feedback button + form.
 *
 * PLACEMENT: bottom-start, not bottom-end. RefreshDataButton occupies
 * `bottom-5 end-5` and, for an admin, both are on screen at once. Using logical
 * `start`/`end` rather than left/right also keeps it correct in this RTL layout
 * without a second rule.
 *
 * The form is intentionally short. Every extra field measurably costs
 * submissions, and the context that would otherwise have to be typed — which
 * page, which city, which chart selection, what screen — is captured
 * automatically. The visitor supplies the one thing only they have: what they
 * think.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    track("feedback_open");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (kind !== "rating" && !message.trim()) { setError("נא לכתוב כמה מילים"); return; }
    if (kind === "rating" && !rating) { setError("נא לבחור דירוג"); return; }
    setSending(true);
    try {
      const vs = getViewState();
      const res = await fetch(withBasePath("/api/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, message, email,
          rating: kind === "rating" ? rating : null,
          website: honeypot,                        // honeypot
          elapsedMs: Date.now() - openedAt.current, // fill-time check
          path: window.location.pathname + window.location.search,
          city: vs.city ?? null,
          viewState: vs.summary ?? null,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          sessionId: (() => { try { return sessionStorage.getItem("karnaf_sid"); } catch { return null; } })(),
        }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (!j.ok) { setError(j.error ?? "לא הצלחנו לשלוח — נסה שוב"); setSending(false); return; }
      setDone(true);
      setTimeout(() => {
        setOpen(false); setDone(false); setMessage(""); setEmail(""); setRating(0); setSending(false);
      }, 1800);
    } catch {
      setError("לא הצלחנו לשלוח — בדוק את החיבור ונסה שוב");
      setSending(false);
    }
  }

  return (
    <>
      {/* z-40 matches RefreshDataButton so neither can cover the other */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="שליחת משוב"
        aria-expanded={open}
        className="fixed bottom-5 start-5 z-40 flex h-12 items-center gap-2 rounded-full bg-indigo-600 px-4 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition-transform hover:bg-indigo-700 active:scale-95"
      >
        <span aria-hidden>💬</span>
        <span className="hidden sm:inline">משוב</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="טופס משוב"
          className="fixed bottom-20 start-5 z-40 w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        >
          {done ? (
            <p className="py-6 text-center text-sm font-bold text-emerald-700">
              תודה! קיבלנו 🙏
            </p>
          ) : (
            <form onSubmit={submit}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black text-slate-900">מה דעתך?</h2>
                  <p className="mt-0.5 text-2xs text-slate-500">האתר בבנייה — כל הערה עוזרת</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="סגירה"
                  className="-me-1 -mt-1 h-7 w-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-1.5">
                {FEEDBACK_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    className={`rounded-lg border px-2 py-1.5 text-2xs font-bold transition-colors ${
                      kind === k
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>

              {kind === "rating" && (
                <div className="mb-3 flex justify-center gap-1" role="radiogroup" aria-label="דירוג">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={rating === n}
                      aria-label={`${n} מתוך 5`} onClick={() => setRating(n)}
                      className={`h-9 w-9 rounded-lg text-lg transition-transform hover:scale-110 ${rating >= n ? "" : "opacity-30"}`}>
                      ⭐
                    </button>
                  ))}
                </div>
              )}

              {/* text-base: iOS zooms into any input under 16px on focus, which
                  yanks the whole layout sideways on a phone */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={kind === "wrong_data" ? "איזה נתון, ואיפה ראית אותו?" : "ספר לנו…"}
                className="mb-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-base focus:border-indigo-400 focus:outline-none sm:text-sm"
              />

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="אימייל (לא חובה — רק אם תרצה תשובה)"
                dir="ltr"
                className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-base focus:border-indigo-400 focus:outline-none sm:text-sm"
              />

              {/* Honeypot: off-screen rather than display:none, which some bots skip. */}
              <input
                type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                className="absolute -left-[9999px] h-0 w-0 opacity-0"
              />

              {error && <p className="mb-2 text-2xs font-semibold text-red-600">{error}</p>}

              <button
                disabled={sending}
                className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300"
              >
                {sending ? "שולח…" : "שליחה"}
              </button>
              <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-400">
                נשמרים גם העמוד והתצוגה הנוכחית, כדי שנוכל לשחזר. לא נאסף מידע מזהה.
              </p>
            </form>
          )}
        </div>
      )}
    </>
  );
}
