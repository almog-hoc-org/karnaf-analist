import type { ReactNode } from "react";
import { type PageKey, reconcile } from "@/lib/pageSections";

/**
 * Renders a page's sections in the order an operator chose in the dashboard.
 *
 * The page hands it a map of key → node; the order comes from
 * lib/sectionOrder. A key present in the map but absent from the order is
 * still rendered (reconcile appends it), which is the property that matters:
 * a section added to the code after an order was saved must not disappear from
 * the live site because of a stale row in app.db.
 *
 * A key in the order with no node — a section that renders nothing for this
 * city, say — is simply skipped.
 */
export default function OrderedSections({
  page,
  order,
  nodes,
}: {
  page: PageKey;
  order: string[];
  nodes: Record<string, ReactNode>;
}) {
  // reconcile against the KEYS THIS PAGE ACTUALLY HANDED US as well, so a node
  // map that is missing an optional section does not leave a hole.
  const full = reconcile(page, order);
  return (
    <>
      {full.map((key) => {
        const node = nodes[key];
        return node ? <div key={key} data-section={key}>{node}</div> : null;
      })}
    </>
  );
}
