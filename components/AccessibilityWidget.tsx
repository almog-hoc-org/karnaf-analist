"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * Floating accessibility panel.
 *
 * A NOTE ON WHAT THIS IS AND IS NOT
 * Commercial "accessibility overlays" that promise conformance in one line of
 * JavaScript are widely criticised, and the criticism is fair: they do not fix
 * an inaccessible page, and some actively interfere with real screen readers.
 *
 * So this widget claims nothing. It offers a small set of controls that
 * genuinely change the page and persist between visits — larger text, higher
 * contrast, visible link underlines, stopped animation, a readable font, a
 * bigger cursor. Those help real people with low vision, dyslexia or vestibular
 * conditions, and they are honest about their scope.
 *
 * It deliberately does NOT touch ARIA, focus order or the accessibility tree.
 * Those are the semantics assistive technology relies on, and an overlay
 * rewriting them at runtime is exactly what breaks screen readers. The real
 * work — semantic markup, labels, keyboard order, contrast — is in the pages
 * themselves; this is an addition to it, not a substitute.
 *
 * Every preference is a class on <html>, styled in globals.css, so the effect
 * survives navigation without React re-applying anything.
 */

const STORAGE_KEY = "karnaf_a11y";

interface Prefs {
  /** 0 = normal, 1 = +15%, 2 = +30%, 3 = +50% */
  fontStep: number;
  contrast: boolean;
  underlineLinks: boolean;
  stopAnimations: boolean;
  readableFont: boolean;
  bigCursor: boolean;
}

const DEFAULTS: Prefs = {
  fontStep: 0,
  contrast: false,
  underlineLinks: false,
  stopAnimations: false,
  readableFont: false,
  bigCursor: false,
};

function apply(p: Prefs) {
  const el = document.documentElement;
  el.classList.remove("a11y-font-1", "a11y-font-2", "a11y-font-3");
  if (p.fontStep > 0) el.classList.add(`a11y-font-${p.fontStep}`);
  el.classList.toggle("a11y-contrast", p.contrast);
  el.classList.toggle("a11y-underline", p.underlineLinks);
  el.classList.toggle("a11y-no-motion", p.stopAnimations);
  el.classList.toggle("a11y-readable", p.readableFont);
  el.classList.toggle("a11y-big-cursor", p.bigCursor);
}

export default function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  // Restore on mount. Reading in an effect rather than during render keeps the
  // server and first client render identical, avoiding a hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = { ...DEFAULTS, ...JSON.parse(raw) } as Prefs;
        setPrefs(saved);
        apply(saved);
      }
    } catch { /* storage blocked — the widget still works for this visit */ }
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      apply(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
    apply(DEFAULTS);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const anyOn = prefs.fontStep > 0 || prefs.contrast || prefs.underlineLinks
    || prefs.stopAnimations || prefs.readableFont || prefs.bigCursor;

  const Toggle = ({ label, icon, on, onClick }: { label: string; icon: string; on: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-semibold transition-colors ${
        on ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span aria-hidden className="text-base"><Icon name={icon} size="1em" /></span>
      <span className="flex-1">{label}</span>
      <span aria-hidden className={`text-xs ${on ? "text-indigo-600" : "text-slate-300"}`}>{on ? "●" : "○"}</span>
    </button>
  );

  return (
    <>
      {/* end-5 keeps it clear of the feedback button at start-5. bottom-20 on
          mobile clears the refresh button when an admin is signed in. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="אפשרויות נגישות"
        aria-expanded={open}
        title="אפשרויות נגישות"
        className="fixed bottom-20 end-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-xl text-white shadow-lg transition-transform hover:bg-slate-900 active:scale-95 md:bottom-5"
      >
        <span aria-hidden><Icon name="accessibility" size="1em" /></span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="אפשרויות נגישות"
          className="fixed bottom-36 end-5 z-40 w-[min(19rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl md:bottom-20"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">אפשרויות נגישות</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="סגירה"
              className="-me-1 h-7 w-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Icon name="close" size="1em" /></button>
          </div>

          <div className="mb-3">
            <p className="mb-1.5 text-2xs font-bold text-slate-500">גודל טקסט</p>
            <div className="flex gap-1.5" role="group" aria-label="גודל טקסט">
              {[0, 1, 2, 3].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update({ fontStep: s })}
                  aria-pressed={prefs.fontStep === s}
                  aria-label={s === 0 ? "גודל רגיל" : `הגדלה ${s}`}
                  className={`flex-1 rounded-lg border py-2 font-bold transition-colors ${
                    prefs.fontStep === s ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  style={{ fontSize: `${0.75 + s * 0.14}rem` }}
                >
                  א
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Toggle label="ניגודיות גבוהה" icon="contrast" on={prefs.contrast}
              onClick={() => update({ contrast: !prefs.contrast })} />
            <Toggle label="הדגשת קישורים" icon="link" on={prefs.underlineLinks}
              onClick={() => update({ underlineLinks: !prefs.underlineLinks })} />
            <Toggle label="עצירת אנימציות" icon="pause" on={prefs.stopAnimations}
              onClick={() => update({ stopAnimations: !prefs.stopAnimations })} />
            <Toggle label="גופן קריא" icon="text-size" on={prefs.readableFont}
              onClick={() => update({ readableFont: !prefs.readableFont })} />
            <Toggle label="סמן מוגדל" icon="cursor" on={prefs.bigCursor}
              onClick={() => update({ bigCursor: !prefs.bigCursor })} />
          </div>

          {anyOn && (
            <button type="button" onClick={reset}
              className="mt-3 w-full rounded-xl border border-slate-200 py-2 text-2xs font-bold text-slate-500 hover:bg-slate-50">
              ↺ איפוס כל ההגדרות
            </button>
          )}

          <p className="mt-3 border-t border-slate-100 pt-2.5 text-center text-[10px] leading-relaxed text-slate-400">
            ההעדפות נשמרות בדפדפן שלך.{" "}
            <Link href="/accessibility" className="font-bold text-indigo-600 hover:underline" onClick={() => setOpen(false)}>
              הצהרת נגישות
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
