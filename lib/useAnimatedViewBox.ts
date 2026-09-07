"use client";

import { useEffect, useRef, useState } from "react";
import type { ViewBox } from "./geo";

/**
 * Tween an SVG viewBox from wherever it is to `target`.
 *
 * viewBox is an attribute, not a CSS property, so it cannot be transitioned
 * with a stylesheet; the map zooms by re-rendering the attribute each frame.
 * 350 ms ease-in-out is long enough to read as "the map moved in" and short
 * enough that a reader who clicks two neighbourhoods in a row never waits.
 * Under prefers-reduced-motion the box snaps — the reader asked for that.
 */
export function useAnimatedViewBox(target: ViewBox, ms = 350): ViewBox {
  const [current, setCurrent] = useState<ViewBox>(target);
  const fromRef = useRef<ViewBox>(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || ms <= 0 || same(fromRef.current, target)) {
      fromRef.current = target;
      setCurrent(target);
      return;
    }
    const from = fromRef.current;
    const started = performance.now();
    const step = (now: number) => {
      // clamped at both ends: a frame timestamp can precede performance.now()
      const t = Math.min(1, Math.max(0, (now - started) / ms));
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out quad
      const box = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      };
      setCurrent(box);
      fromRef.current = box;
      if (t < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.w, target.h, ms]);

  return current;
}

function same(a: ViewBox, b: ViewBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
