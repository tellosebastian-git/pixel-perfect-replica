import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
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
        status: {
          success: {
            DEFAULT: "hsl(var(--status-success))",
            foreground: "hsl(var(--status-success-foreground))",
            bg: "hsl(var(--status-success-bg))",
          },
          warning: {
            DEFAULT: "hsl(var(--status-warning))",
            foreground: "hsl(var(--status-warning-foreground))",
            bg: "hsl(var(--status-warning-bg))",
          },
          error: {
            DEFAULT: "hsl(var(--status-error))",
            foreground: "hsl(var(--status-error-foreground))",
            bg: "hsl(var(--status-error-bg))",
          },
          info: {
            DEFAULT: "hsl(var(--status-info))",
            foreground: "hsl(var(--status-info-foreground))",
            bg: "hsl(var(--status-info-bg))",
          },
          purple: {
            DEFAULT: "hsl(var(--status-purple))",
            foreground: "hsl(var(--status-purple-foreground))",
            bg: "hsl(var(--status-purple-bg))",
          },
          indigo: {
            DEFAULT: "hsl(var(--status-indigo))",
            foreground: "hsl(var(--status-indigo-foreground))",
            bg: "hsl(var(--status-indigo-bg))",
          },
        },
        "chart-cash": "hsl(var(--chart-cash))",
        "chart-mp": "hsl(var(--chart-mp))",
        "chart-cost": "hsl(var(--chart-cost))",
        "chart-orange": "hsl(var(--chart-orange))",
        "chart-amber": "hsl(var(--chart-amber))",
        "chart-purple": "hsl(var(--chart-purple))",
        "chart-indigo": "hsl(var(--chart-indigo))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        container: "var(--radius-container)",
        tile: "var(--radius-tile)",
      },
      transitionDuration: {
        "sidebar-text": "120ms",
        highlight: "250ms",
        tooltip: "120ms",
      },
      transitionDelay: {
        "sidebar-width": "60ms",
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
        "collapsible-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-collapsible-content-height)",
          },
        },
        "collapsible-up": {
          from: {
            height: "var(--radix-collapsible-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "logo-enter": {
          from: {
            opacity: "0",
            transform: "scale(0.95) translateY(6px)",
          },
          to: {
            opacity: "1",
            transform: "scale(1) translateY(0)",
          },
        },
        "logo-breathe": {
          "0%, 100%": {
            opacity: "1",
          },
          "50%": {
            opacity: "0.55",
          },
        },
        "logo-exit": {
          from: {
            opacity: "1",
            transform: "scale(1)",
          },
          to: {
            opacity: "0",
            transform: "scale(1.045)",
          },
        },
        "screen-in": {
          from: {
            opacity: "0",
          },
          to: {
            opacity: "1",
          },
        },
        "screen-out": {
          from: {
            opacity: "1",
            filter: "blur(0px)",
          },
          to: {
            opacity: "0",
            filter: "blur(2px)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
        "logo-enter": "logo-enter 420ms var(--ease-out-quint) forwards",
        "logo-breathe": "logo-breathe 1600ms var(--ease-out-quint) infinite",
        "logo-exit": "logo-exit 200ms var(--ease-in-quint) forwards",
        "screen-in": "screen-in 180ms var(--ease-out-quint) forwards",
        "screen-out": "screen-out 220ms var(--ease-in-quint) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
