import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function GET(req: Request) {
  destroySession();
  return NextResponse.redirect(new URL("/", req.url));
}
