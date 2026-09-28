import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The site's one button.
 *
 * Until 9/2026 every call site re-declared its own `bg-indigo-600 …` string —
 * thirteen different "primary" buttons in four radii and eight paddings — and
 * nothing said which action on a screen was THE action. The rule this encodes:
 *
 *   primary    — at most ONE per screen: the thing we want the reader to do next
 *   secondary  — outlined; a real alternative, never beside another primary
 *   ghost      — quiet text-weight action (share, feedback, "more")
 *   link       — inline text link
 *
 * Renders a Next <Link> when `href` is given, otherwise a <button>.
 */
type Variant = "primary" | "secondary" | "ghost" | "link";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-300",
  secondary: "border border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  link: "text-indigo-700 underline-offset-4 hover:underline",
};
const SIZE: Record<Size, string> = {
  sm: "gap-1 rounded-lg px-3 py-1.5 text-xs",
  md: "gap-1.5 rounded-xl px-4 py-2.5 text-sm",
  lg: "gap-2 rounded-xl px-6 py-3.5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = ""): string {
  const base = "inline-flex items-center justify-center whitespace-nowrap font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const pad = variant === "link" ? "p-0 text-sm" : SIZE[size];
  return `${base} ${pad} ${VARIANT[variant]} ${extra}`.trim();
}

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };

export default function Button(
  props: Common & ({ href: string } & Omit<ComponentProps<typeof Link>, "href" | "className">
    | { href?: undefined } & Omit<ComponentProps<"button">, "className">)
) {
  const { variant = "primary", size = "md", className = "", children, ...rest } = props;
  const cls = buttonClass(variant, size, className);
  if ("href" in rest && rest.href) {
    const { href, ...linkRest } = rest as { href: string } & Record<string, unknown>;
    return <Link href={href} className={cls} {...linkRest}>{children}</Link>;
  }
  const btn = rest as ComponentProps<"button">;
  return <button type={btn.type ?? "button"} className={cls} {...btn}>{children}</button>;
}
