import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filename, data } = body;

    if (!filename || !data) {
      return NextResponse.json({ error: "Missing filename or data" }, { status: 400 });
    }

    // Only allow saving to data/ directory
    const safeName = path.basename(filename);
    const dataDir = path.join(process.cwd(), "data");
    const filePath = path.join(dataDir, safeName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    return NextResponse.json({ ok: true, path: filePath, records: Array.isArray(data) ? data.length : 1 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
