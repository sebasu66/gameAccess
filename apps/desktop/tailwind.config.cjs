/**
 * Tailwind is scoped to the Library Manager: it only scans the new components, the CSS reset is off
 * (the rest of the app keeps its own stylesheets) and every utility is !important so the app's global
 * rules such as `.ga-settings-panel button` cannot override a shadcn component.
 */
module.exports = {
  content: ["./src/library-manager/**/*.{ts,tsx}", "./src/components/ui/**/*.{ts,tsx}"],
  important: true,
  corePlugins: { preflight: false, container: false },
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--lm-background) / <alpha-value>)",
        foreground: "rgb(var(--lm-foreground) / <alpha-value>)",
        card: "rgb(var(--lm-card) / <alpha-value>)",
        muted: "rgb(var(--lm-muted) / <alpha-value>)",
        "muted-foreground": "rgb(var(--lm-muted-foreground) / <alpha-value>)",
        primary: "rgb(var(--lm-primary) / <alpha-value>)",
        "primary-foreground": "rgb(var(--lm-primary-foreground) / <alpha-value>)",
        destructive: "rgb(var(--lm-destructive) / <alpha-value>)",
        success: "rgb(var(--lm-success) / <alpha-value>)",
        warning: "rgb(var(--lm-warning) / <alpha-value>)",
        info: "rgb(var(--lm-info) / <alpha-value>)",
        border: "rgb(var(--lm-foreground) / 0.14)",
      },
      fontFamily: { display: ['"Bebas Neue"', "sans-serif"], sans: ["Manrope", '"Segoe UI"', "sans-serif"] },
      borderRadius: { lg: "12px", md: "8px", sm: "6px" },
      keyframes: { spin: { to: { transform: "rotate(360deg)" } } },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
