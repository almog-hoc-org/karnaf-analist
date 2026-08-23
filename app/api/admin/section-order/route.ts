import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { PAGE_SECTIONS, PAGE_LABELS, PAGE_KEYS, isPageKey } from "@/lib/pageSections";
import { getSectionOrder, setSectionOrder, resetSectionOrder, hasStoredOrder } from "@/lib/sectionOrder";

export const dynamic = "force-dynamic";

/** Catalogue + current order for every page, so the panel renders from one call. */
function snapshot() {
  return PAGE_KEYS.map((page) => ({
    page,
    label: PAGE_LABELS[page],
    custom: hasStoredOrder(page),
    sections: getSectionOrder(page).map((key) => {
      const def = PAGE_SECTIONS[page].find((d) => d.key === key)!;
      return { key, label: def.label, hint: def.hint ?? null };
    }),
  }));
}

export async function GET() {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ pages: snapshot() });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const page = String(body.page ?? "");
  if (!isPageKey(page)) return NextResponse.json({ error: "unknown page" }, { status: 400 });

  if (body.action === "reset") {
    resetSectionOrder(page);
  } else {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : null;
    if (!keys) return NextResponse.json({ error: "keys must be an array" }, { status: 400 });
    setSectionOrder(page, keys);
  }
  // No cache to bust: both pages that read this order are dynamic (they read
  // cookies), and lib/sectionOrder holds the value for 5 seconds at most.
  return NextResponse.json({ ok: true, pages: snapshot() });
}
