/**
 * "Send to a friend" — a plain anchor to wa.me, computed server-side so the
 * sharer's referral code is already baked into the link (lib/share.ts).
 * The friend hits the registration wall; when they sign up with the code,
 * the sharer earns the referral bonus.
 */
export default function CityShareButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
      title="שיתוף עמוד העיר בוואטסאפ"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.5.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3 0-.2 0-.3-.1-.4l-.8-1.9c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3a2.6 2.6 0 0 0-.8 2c0 1.1.8 2.2 1 2.4.1.2 1.7 2.6 4.1 3.7 1.5.6 2.1.7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0 0-.1-.1-.2-.1Z" />
      </svg>
      שלח לחבר
    </a>
  );
}
