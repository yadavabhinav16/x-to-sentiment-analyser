import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
        border2: "#262626",
        accent: "#3b82f6",
      },
    },
  },
  plugins: [],
};
export default config;
