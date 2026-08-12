import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ── Type scale ──────────────────────────────────────────────────────
      // Rebuilt 2026-07-31. The previous scale collapsed tokens onto duplicate
      // sizes (xs===sm===13, lg===xl===20, 3xl===4xl===30, 5xl===6xl===7xl===44).
      // Consequences measured across the codebase: `text-[11px]` became the most
      // used class in the app (302×) because no 11px token existed; 335 xs/sm
      // usages expressed a distinction that never rendered; and every
      // `text-3xl md:text-4xl` was a silent no-op.
      // Now every step is DISTINCT, so size can carry hierarchy again:
      //   2xs 11 caption · xs 13 meta · sm 14 secondary · base 16 body
      //   lg 18 lead · xl 20 card title · 2xl 24 section · 3xl 30 page
      //   4xl 36 · 5xl 44 hero
      //
      // 2026-08 — two changes, both from Apple's UI-typography guidance.
      //
      // (1) REM, NOT PX. The accessibility widget offers three text-enlargement
      // steps (html.a11y-font-* in globals.css), and they did nothing: every
      // token here was a fixed px value, which html { font-size } cannot scale.
      // Tailwind spacing is already rem, so the page inflated around text that
      // never grew. Values are identical at the 16px default — 0.6875rem IS
      // 11px — so nothing moves until someone actually asks for larger text.
      //
      // (2) OPTICAL SIZING. Tracking is a function of size, so it belongs on
      // the token, not on call sites: 41 headings used text-2xl/text-3xl with
      // no tracking class and rendered loose, while .t-title at the same 24px
      // applied -0.015em — the same heading looked different depending on which
      // one the author reached for. Large type tightens, small type opens up.
      // Leading rises slightly at caption sizes: Hebrew has no x-height relief,
      // so 1.45 on an 11px caption reads cramped.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1.5", letterSpacing: "0.01em" }],   // 11px
        xs: ["0.8125rem", { lineHeight: "1.5", letterSpacing: "0.005em" }],     // 13px
        sm: ["0.875rem", { lineHeight: "1.55" }],                               // 14px
        base: ["1rem", { lineHeight: "1.6" }],                                  // 16px
        lg: ["1.125rem", { lineHeight: "1.45", letterSpacing: "-0.003em" }],    // 18px
        xl: ["1.25rem", { lineHeight: "1.35", letterSpacing: "-0.005em" }],     // 20px
        "2xl": ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.01em" }],    // 24px
        "3xl": ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],  // 30px
        "4xl": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],   // 36px
        "5xl": ["2.75rem", { lineHeight: "1.08", letterSpacing: "-0.022em" }],  // 44px
        "6xl": ["3.25rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],  // 52px
        "7xl": ["3.75rem", { lineHeight: "1.02", letterSpacing: "-0.028em" }],  // 60px
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // "Petrol Steel" brand scale — the whole site references `indigo-*`
        // classes, so remapping the scale here recolors everything at once.
        // Deep teal-steel: professional, confident, unmistakably not purple.
        indigo: {
          50: "#eef9fb",
          100: "#d9f1f5",
          200: "#b5e2ea",
          300: "#7cc8d6",
          400: "#3aa6bc",
          500: "#17879f",
          600: "#0e7490",
          700: "#155e75",
          800: "#164e63",
          900: "#103c4d",
          950: "#082f3c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
