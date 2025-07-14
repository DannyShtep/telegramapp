import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Новые цвета для luxury темы
        gold: {
          DEFAULT: "#FFD700", // Pure Gold
          dark: "#DAA520", // Goldenrod
          light: "#FFEB3B", // Light Gold
        },
        emerald: {
          DEFAULT: "#00C853", // Vibrant Emerald
          dark: "#00796B", // Dark Teal
          light: "#69F0AE", // Light Green
        },
        sapphire: {
          DEFAULT: "#2196F3", // Vibrant Blue
          dark: "#1976D2", // Dark Blue
          light: "#90CAF9", // Light Blue
        },
        ruby: {
          DEFAULT: "#D32F2F", // Deep Red
          dark: "#B71C1C", // Dark Red
          light: "#EF9A9A", // Light Red
        },
        charcoal: {
          DEFAULT: "#333333",
          dark: "#222222",
          light: "#444444",
        },
        darkblue: {
          DEFAULT: "#0A0A2A",
          light: "#1A1A3A",
          dark: "#05051A",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // Новые/измененные анимации для luxury стиля
        "fade-in-subtle": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in-subtle": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
        "glow-subtle": {
          "0%, 100%": { boxShadow: "0 0 10px rgba(255, 215, 0, 0.3)" },
          "50%": { boxShadow: "0 0 20px rgba(255, 215, 0, 0.6)" },
        },
        "spin-elegant": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-subtle": "fade-in-subtle 0.5s ease-out forwards",
        "scale-in-subtle": "scale-in-subtle 0.4s ease-out forwards",
        "pulse-subtle": "pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow-subtle": "glow-subtle 3s ease-in-out infinite",
        "spin-elegant": "spin-elegant 30s linear infinite", // Более медленное вращение
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
export default config
