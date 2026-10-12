import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        page: v("page"),
        panel: v("panel"),
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        petrol: { DEFAULT: v("petrol"), deep: v("petrol-deep"), soft: v("petrol-soft") },
        good: { DEFAULT: v("good"), soft: v("good-soft") },
        warn: { DEFAULT: v("warn"), soft: v("warn-soft") },
        crit: { DEFAULT: v("crit"), soft: v("crit-soft") },
        info: { DEFAULT: v("info"), soft: v("info-soft") },
        hazard: v("hazard"),
        series: { 1: "#2a78d6", cmp: "#8a959e", target: "#14212b" },
      },
      fontFamily: { sans: ['"Archivo Variable"', "system-ui", "sans-serif"] },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: { DEFAULT: "6px", sm: "4px", lg: "10px" },
    },
  },
  plugins: [],
} satisfies Config;
