import Link from "next/link";
import { addressSlug } from "@/lib/buildingRules";

/**
 * The street page's deal list: date · building (a link to its page) · m² ·
 * price, rooms/floor/₪m² as the muted second line — the same four columns
 * as every other deal table on the site. A server component: nothing here
 * needs state, and the links must be in the HTML for a crawler.
 */
export default function AddressDealsTable({ deals, cityName, street }: {
  deals: Array<{ id: number; dealDate: string; rooms: number | null; area: number | null; price: number | null; priceSqm: number | null; floor: string | null; houseNum: string | null; yearBuilt: number | null; isSecondHand: boolean }>;
  cityName: string; street: string;
}) {
  const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
  if (!deals.length) return <p className="text-sm text-slate-500">אין עסקאות.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full table-fixed text-xs">
        <colgroup><col className="w-24" /><col /><col className="w-12" /><col className="w-24" /></colgroup>
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
          <th className="px-3 py-2 text-right font-bold">תאריך</th><th className="px-3 py-2 text-right font-bold">בניין</th>
          <th className="px-2 py-2 text-center font-bold">מ״ר</th><th className="px-3 py-2 text-center font-bold">מחיר</th>
        </tr></thead>
        <tbody>{deals.map((d) => {
          const sub = [d.rooms == null ? null : `${d.rooms} חד׳`, d.floor ? `קומה ${d.floor}` : null, d.priceSqm == null ? null : `${nis(d.priceSqm)}/מ״ר`, d.isSecondHand ? null : "חדשה"].filter(Boolean).join(" · ");
          return (
            <tr key={d.id} className="border-b border-slate-100 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">{d.dealDate}</td>
              <td className="px-3 py-1.5 text-right leading-tight">
                {d.houseNum ? (
                  <Link href={`/city/${encodeURIComponent(cityName)}/address/${encodeURIComponent(addressSlug(street, d.houseNum))}`} className="block truncate font-bold text-slate-800 hover:text-indigo-700 hover:underline">{street} {d.houseNum}</Link>
                ) : <span className="block truncate text-slate-400">{street} — ללא מספר</span>}
                {sub && <span className="block truncate text-2xs text-slate-400">{sub}</span>}
              </td>
              <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{d.area == null ? "—" : Math.round(d.area)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-center font-bold tabular-nums text-slate-800">{nis(d.price)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
