import { labelForPath } from "@/lib/pageLabels";
import { withBasePath } from "@/lib/basePath";

/**
 * A logged path, shown as the page it actually is.
 *
 * The dashboard used to print `/rankings/highest-gain` and `/city/%D7%97...`,
 * which are answerable only by someone holding the routing table in their head
 * — i.e. not by the person the dashboard is for. The name comes first, the raw
 * path stays underneath in small grey type (it is still the identifier, and
 * hiding it entirely would make two similar rows indistinguishable), and the
 * whole thing links out so "what IS this page" is one click rather than a
 * reconstruction.
 *
 * Opens in a new tab on purpose: an operator checking a page against its
 * numbers wants both, not one instead of the other.
 */
export default function PageName({ path, className = "" }: { path: string; className?: string }) {
  const { label, href } = labelForPath(path);
  const isSame = label === path; // unknown route — do not print the path twice

  return (
    <a
      href={withBasePath(href)}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block min-w-0 ${className}`}
      title={path}
    >
      <span className="block truncate font-semibold text-slate-800 group-hover:text-indigo-700 group-hover:underline">
        {label}
        <span aria-hidden className="ms-1 text-2xs text-slate-300 group-hover:text-indigo-400">↗</span>
      </span>
      {!isSame && (
        <span dir="ltr" className="block truncate text-2xs text-slate-400">{path}</span>
      )}
    </a>
  );
}
