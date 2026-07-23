import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
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
