"use client";

import { useEffect, useState } from "react";

/**
 * True below the given width (default: Tailwind's sm breakpoint, 640px).
 * SSR-safe: renders desktop first, corrects on mount — charts/controls only
 * COMPACT on mobile, so the brief desktop-first paint is harmless.
 */
export function useIsMobile(maxWidth = 639): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);
  return mobile;
}
