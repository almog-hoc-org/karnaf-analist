"use client";

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

interface ProgressEvent {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export default function RefreshDataButton() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [summary, setSummary] = useState<ProgressEvent["data"] | null>(null);
  const [hidden, setHidden] = useState(false); // mobile: slide away while scrolling down
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom on new event
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // Mobile-only courtesy: the button ducks out while scrolling down so it can
  // never sit on content the user is reading; it returns on any upward scroll.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) return;
    let lastY = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        setHidden(y > lastY && y > 120);
        lastY = y;
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  async function startRefresh() {
    setRunning(true);
    setEvents([]);
    setSummary(null);
    setOpen(true);
    try {
      const res = await fetch(withBasePath("/api/refresh-data"), { method: "POST" });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const m = line.match(/^data:\s*(.*)$/);
          if (!m) continue;
          try {
            const evt = JSON.parse(m[1]) as ProgressEvent;
            if (evt.type === "summary") setSummary(evt.data);
            if (evt.type !== "done") {
              setEvents((prev) => [...prev, evt]);
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: "error", message: `שגיאה: ${err}` }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {/* Floating action button — icon-only circle on mobile (a 150px labeled
          pill permanently covered table rows/footer links on a 375px phone),
          full labeled pill from sm up; ducks away while scrolling down on mobile */}
      <button
        type="button"
        onClick={() => (running ? setOpen(true) : startRefresh())}
        className={`fixed bottom-5 end-5 z-40 group inline-flex items-center gap-2 p-3.5 sm:px-4 sm:py-3 rounded-full font-bold text-sm shadow-2xl transition-all ${
          hidden ? "translate-y-20 opacity-0 pointer-events-none sm:translate-y-0 sm:opacity-100 sm:pointer-events-auto" : ""
        } ${
          running
            ? "bg-slate-600 text-white hover:bg-slate-700"
            : "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-500/40 hover:scale-105"
        }`}
        aria-label="רענן נתונים"
        title="סריקת פרסומים חדשים — למ״ס + משרד האוצר"
      >
        <span className={`text-base ${running ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}>
          {running ? "⟳" : <Icon name="refresh" size="1em" />}
        </span>
        <span className="hidden sm:inline">{running ? "מרענן..." : "רענן נתונים"}</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
          onClick={() => !running && setOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-indigo-50/60">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white text-lg flex items-center justify-center shadow-lg">
                {running ? <span className="animate-spin">⟳</span> : <Icon name="refresh" size="1em" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  {running ? "מחפש דוחות עדכניים..." : "סיכום עדכון נתונים"}
                </h3>
                <p className="text-2xs text-slate-500 mt-0.5">
                  סורק למ&quot;ס + משרד האוצר לפי כותרת (דירה/מגורים/נדל&quot;ן…) • רץ ברקע — אפשר לסגור את החלון • דוחות שכבר במערכת מדולגים
                </p>
              </div>
              {!running && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 text-lg"
                  aria-label="סגור"
                >
                  ×
                </button>
              )}
            </header>

            {/* Live log */}
            <div ref={logRef} className="flex-1 overflow-y-auto p-4 bg-slate-50/40 space-y-1.5 text-xs">
              {events.length === 0 && (
                <div className="text-center text-slate-400 py-8">
                  <div className="text-3xl mb-2 animate-pulse">⟳</div>
                  <div className="text-sm">מתחיל...</div>
                </div>
              )}
              {events.map((e, i) => {
                const cls =
                  e.type === "found" ? "bg-indigo-50 text-indigo-800 border-indigo-200" :
                  e.type === "error" ? "bg-red-50 text-red-800 border-red-200" :
                  e.type === "summary" ? "bg-indigo-50 text-indigo-900 border-indigo-200 font-bold" :
                  e.type === "log" ? "bg-white text-slate-700 border-slate-200" :
                  "text-slate-500";
                return (
                  <div key={i} className={`px-3 py-1.5 rounded-lg border ${cls} leading-relaxed`}>
                    {e.message}
                  </div>
                );
              })}
            </div>

            {/* Summary footer */}
            {summary && !running && (
              <footer className="px-5 py-4 border-t border-slate-100 bg-white">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <KpiCell label="נבדקו" value={String(summary.attempted ?? 0)} tone="slate" />
                  <KpiCell label="חדשים" value={String(summary.found ?? 0)} tone="indigo" />
                  <KpiCell label="דולגו" value={String(summary.skipped ?? 0)} tone="slate" />
                  <KpiCell label="שגיאות" value={String(summary.errors ?? 0)} tone="red" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm"
                  >
                    סגור
                  </button>
                  {Number(summary.found ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm"
                    >
                      רענן את הדף לראות שינויים →
                    </button>
                  )}
                </div>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function KpiCell({ label, value, tone }: { label: string; value: string; tone: "slate" | "indigo" | "red" }) {
  const cls = tone === "indigo" ? "text-indigo-700 bg-indigo-50 border-indigo-200"
            : tone === "red" ? "text-red-700 bg-red-50 border-red-200"
            : "text-slate-700 bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg p-2 border text-center ${cls}`}>
      <div className="text-2xs font-semibold opacity-70 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-extrabold tabular-nums leading-none mt-1">{value}</div>
    </div>
  );
}
