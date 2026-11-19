import type { Config } from "tailwindcss";

/**
 * Sprinto palette (read from sprinto.com): deep plum #650A41, lime accent #DCF07F,
 * cream #FBF4F1, lavender #EBE2FE — plus a pink accent for this dashboard.
 * `brand` = plum, so existing brand-* classes pick up the Sprinto colour.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-instrument)", "Instrument Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: { 50: "#FBF2F7", 100: "#F6E1EC", 200: "#EBC1D7", 300: "#D68DB3", 400: "#BC5A8C", 500: "#A3336F", 600: "#84195A", 700: "#650A41", 800: "#520835", 900: "#3A0526" },
        blush: { 50: "#FFF1F7", 100: "#FFE0EE", 200: "#FFC2DE", 300: "#FF94C2", 400: "#F965A6", 500: "#EC4899", 600: "#D02A7D", 700: "#AD1D64" },
        zest: { 100: "#F4FAD6", 200: "#EAF5B0", 300: "#DCF07F", 400: "#C9E255", 500: "#AFC832" },
        cream: { 50: "#FFFCFA", 100: "#FBF4F1", 200: "#F6E9E3" },
        lavender: { 100: "#F4EFFE", 200: "#EBE2FE", 300: "#D9C9FC" },
        ink: { 900: "#141012", 700: "#50454C", 500: "#7B6F76" },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(101,10,65,.04), 0 8px 24px -12px rgba(101,10,65,.18)",
        lift: "0 2px 4px rgba(101,10,65,.06), 0 18px 40px -16px rgba(101,10,65,.30)",
        glow: "0 0 0 4px rgba(236,72,153,.15)",
      },
      keyframes: {
        fadeUp: { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        growX: { "0%": { transform: "scaleX(0)" }, "100%": { transform: "scaleX(1)" } },
        floaty: { "0%,100%": { transform: "translate(0,0) scale(1)" }, "50%": { transform: "translate(18px,-14px) scale(1.06)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        ping2: { "0%": { transform: "scale(1)", opacity: ".7" }, "80%,100%": { transform: "scale(2.4)", opacity: "0" } },
        wiggle: { "0%,100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-8deg)" }, "75%": { transform: "rotate(8deg)" } },
      },
      animation: {
        "fade-up": "fadeUp .55s cubic-bezier(.2,.7,.2,1) both",
        "grow-x": "growX 1.1s cubic-bezier(.2,.7,.2,1) both",
        floaty: "floaty 14s ease-in-out infinite",
        shimmer: "shimmer 2.2s linear infinite",
        ping2: "ping2 1.8s cubic-bezier(0,0,.2,1) infinite",
        wiggle: "wiggle .5s ease-in-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
