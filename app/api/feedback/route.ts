/**
 * POST /api/feedback — visitor feedback intake.
 *
 * Public by design: the people whose opinion matters most are anonymous
 * visitors, and putting a login in front of a feedback box guarantees you only
 * hear from people who were already committed.
 *
 * Three cheap spam defences, chosen because none of them makes a real person
 * work harder:
 *   1. honeypot — a field hidden from humans; bots fill it in, people cannot
 *   2. minimum fill time — a form submitted in under a second was not typed
 *   3. per-IP rate limit — bounds a determined submitter
 * No CAPTCHA. It would tax every honest visitor to inconvenience a bot that,
 * at this scale, is not the threat.
 */
import { NextRequest, NextResponse } from "next/server";
import { sendFeedbackNotification } from "@/lib/notify";
import { saveFeedback } from "@/lib/feedback";
import { FEEDBACK_KINDS, type FeedbackKind } from "@/lib/feedbackTypes";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Anything faster than this was not typed by a person. */
const MIN_FILL_MS = 1200;

export async function POST(req: NextRequest) {
  const gate = rateLimit(`feedback:${clientIp(req.headers)}`, 8, 60 * 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "נשלחו כבר כמה פניות מהכתובת הזו — נסה שוב בעוד שעה" },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "בקשה לא תקינה" }, { status: 400 });
  }

  // Honeypot and timing checks answer 200 with ok:true on purpose: a bot that
  // learns it was caught adapts, and there is no user to inform.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }
  const elapsed = Number(body.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
    return NextResponse.json({ ok: true });
  }

  const kind = String(body.kind ?? "");
  if (!FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
    return NextResponse.json({ ok: false, error: "סוג לא תקין" }, { status: 400 });
  }

  const res = saveFeedback({
    kind: kind as FeedbackKind,
    message: String(body.message ?? ""),
    rating: body.rating == null ? null : Number(body.rating),
    email: typeof body.email === "string" ? body.email : null,
    path: typeof body.path === "string" ? body.path : null,
    city: typeof body.city === "string" ? body.city : null,
    viewState: typeof body.viewState === "string" ? body.viewState : null,
    viewport: typeof body.viewport === "string" ? body.viewport : null,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
    buildSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? null,
  });

  if (!res.ok) return NextResponse.json(res, { status: 400 });

  // Email AFTER the database write, and never in front of the response.
  // The row is the source of truth; this is the notification. A visitor must
  // not be told their message failed because our mail provider is down when it
  // is already stored — and must not wait on Resend to see the confirmation.
  void sendFeedbackNotification({
    kind: String(kind),
    message: String(body.message ?? ""),
    rating: body.rating == null ? null : Number(body.rating),
    email: typeof body.email === "string" ? body.email : null,
    path: typeof body.path === "string" ? body.path : null,
    city: typeof body.city === "string" ? body.city : null,
    viewState: typeof body.viewState === "string" ? body.viewState : null,
    viewport: typeof body.viewport === "string" ? body.viewport : null,
  }).catch(() => { /* logged inside; never reaches the visitor */ });

  return NextResponse.json({ ok: true });
}
