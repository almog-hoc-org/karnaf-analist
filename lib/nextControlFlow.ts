/**
 * Re-throw the errors Next.js uses as control flow.
 *
 * WHY THIS EXISTS — IT TOOK THE CITY PAGES DOWN
 * Next signals three things by THROWING, and expects the throw to reach the
 * framework untouched:
 *
 *   digest DYNAMIC_SERVER_USAGE  cookies()/headers() were read during a static
 *                                render — "stop prerendering, go dynamic"
 *   digest NEXT_REDIRECT         redirect() was called
 *   digest NEXT_NOT_FOUND        notFound() was called
 *
 * A `catch {}` around any of them does not handle an error; it cancels an
 * instruction to the framework. getCurrentUser() had exactly that shape — a
 * catch-all guarding a database read that also wrapped a cookies() call — and
 * the consequence was not a swallowed log line:
 *
 *   at BUILD time ADMIN_PASSWORD is unset (it is in env_file, not a Docker
 *   build arg), so isAdminRequest() returned early WITHOUT touching cookies,
 *   and getCurrentUser() ate the bail-out. Next concluded no page reads
 *   cookies and marked them all static.
 *
 *   at RUN time ADMIN_PASSWORD IS set, so isAdminRequest() really did read
 *   cookies — and Next refuses a page that "changed from static to dynamic at
 *   runtime". Every city page answered 500.
 *
 * The two environments disagreeing is what made it invisible: the build was
 * green, the container was healthy, the logs showed a clean start, and the
 * failure only appeared on a page whose params were not prerendered.
 *
 * So: catch what you can handle, and let the framework's own signals pass.
 */
export function rethrowIfNextControlFlow(e: unknown): void {
  const digest = (e as { digest?: unknown } | null | undefined)?.digest;
  if (typeof digest !== "string") return;
  // NEXT_REDIRECT carries its target appended (NEXT_REDIRECT;replace;/login;...),
  // so it is matched by prefix; the other two are exact.
  if (
    digest === "DYNAMIC_SERVER_USAGE" ||
    digest === "NEXT_NOT_FOUND" ||
    digest.startsWith("NEXT_REDIRECT")
  ) {
    throw e;
  }
}
