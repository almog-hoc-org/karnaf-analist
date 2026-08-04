"use client";

import Image from "next/image";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { withBasePath } from "@/lib/basePath";

/**
 * The mascot, with a fallback that is never a broken image.
 *
 * WHY THE FALLBACK EXISTS
 * The first version of this hard-depended on public/karnaf.png. The artwork is
 * delivered separately from the code — it cannot be committed from the machine
 * that writes the components — so there is a real window where the deploy has
 * the markup and not the file. During that window every page rendered a broken
 * image in a sticky header: worse than the plain letter mark it replaced.
 *
 * That is a bad trade to make even once, and it is not a one-off risk. Anyone
 * renaming or moving the asset later would reproduce it, on every page, and the
 * build would pass — next/image resolves a public/ path at request time, not at
 * compile time, so nothing catches it.
 *
 * So a missing file degrades to the original letter mark instead. The header
 * stays intact and the failure is visible to an operator without being ugly to
 * a visitor.
 *
 * `priority` on the header instance only: it is above the fold on every page and
 * is the one image worth blocking on. Marking every instance priority would
 * defeat the point by making the footer copy load just as eagerly.
 */
export default function BrandMark({
  size = 32,
  priority = false,
  className = "",
}: {
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-label={`${BRAND.name} — לוגו`}
        role="img"
        className={`flex shrink-0 items-center justify-center rounded-xl bg-indigo-600 font-black text-white shadow-sm ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      >
        ק
      </span>
    );
  }

  return (
    <Image
      src={withBasePath(BRAND.mascot)}
      alt={`${BRAND.name} — לוגו`}
      width={size}
      height={size}
      priority={priority}
      onError={() => setFailed(true)}
      className={`shrink-0 select-none ${className}`}
      // The source is a square PNG with transparency; contain keeps it honest
      // if a later revision of the artwork is not perfectly square.
      style={{ objectFit: "contain" }}
    />
  );
}
