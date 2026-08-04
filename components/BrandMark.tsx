import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { withBasePath } from "@/lib/basePath";

/**
 * The mascot, at a given size, with a text fallback that is never a broken image.
 *
 * The site shipped with a generic indigo square holding the letter ק — the
 * placeholder look this is replacing. Using next/image rather than a plain <img>
 * keeps the layout from shifting while it loads, which on a mascot sitting in a
 * sticky header would otherwise nudge the whole nav on first paint.
 *
 * `priority` on the header instance only: it is above the fold on every page and
 * is the one image worth blocking on. Marking every instance priority would
 * defeat the point by making the browser fetch the footer copy just as eagerly.
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
  return (
    <Image
      src={withBasePath(BRAND.mascot)}
      alt={`${BRAND.name} — לוגו`}
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 select-none ${className}`}
      // The source is a square PNG with transparency; contain keeps it honest if
      // a later revision of the artwork is not perfectly square.
      style={{ objectFit: "contain" }}
    />
  );
}
