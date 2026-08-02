import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { withBasePath } from "@/lib/basePath";

export async function GET(req: Request) {
  destroySession();
  // new URL("/", req.url) resolves against the ORIGIN and so discards any base
  // path — logging out of /analist would land the user on the domain root.
  return NextResponse.redirect(new URL(withBasePath("/"), req.url));
}
