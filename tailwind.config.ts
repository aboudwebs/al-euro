import type {Config} from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.tsx", "./components/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        gold: "#c9a45c",
        // `white` is theme-aware: it is white in the dark theme and the ink colour in the light theme
        // (see --c-white in app/globals.css), so every existing `text-white/60`, `border-white/10`,
        // `bg-white/[0.08]` utility inverts correctly without per-page overrides.
        white: "rgb(var(--c-white) / <alpha-value>)",
        // Always-white, for text/knobs that sit on a coloured fill (blue buttons, switch knob).
        snow: "#ffffff",
      },
    },
  },
  plugins: [],
} satisfies Config;
