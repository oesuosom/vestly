import { colors, z } from './src/utils/tokens.ts'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  // No `darkMode` key: Tailwind 4 takes the dark variant from
  // `@variant dark (&:where(.dark, .dark *))` in src/app/index.css, and a
  // `darkMode` here has no effect (verified — output CSS is byte-identical).
  theme: {
    extend: {
      fontFamily: {
        sans: ['TASA Orbiter', 'sans-serif'],
        mono: ['monospace'],
      },
      colors,
      zIndex: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, String(v)])),
      boxShadow: {
        xs: '0 8px 16px -4px rgba(10,10,10,0.05)',
        sm: '0 8px 16px -4px rgba(10,10,10,0.08)',
        md: '0 12px 24px -8px rgba(10,10,10,0.12)',
      },
    },
  },
  plugins: [],
}
