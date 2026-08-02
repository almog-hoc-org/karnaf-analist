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
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.45" }],
        xs: ["13px", { lineHeight: "1.45" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.6" }],
        lg: ["18px", { lineHeight: "1.45" }],
        xl: ["20px", { lineHeight: "1.35" }],
        "2xl": ["24px", { lineHeight: "1.25" }],
        "3xl": ["30px", { lineHeight: "1.2" }],
        "4xl": ["36px", { lineHeight: "1.15", letterSpacing: "-0.01em" }],
        "5xl": ["44px", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
        "6xl": ["52px", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "7xl": ["60px", { lineHeight: "1.02", letterSpacing: "-0.025em" }],
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
