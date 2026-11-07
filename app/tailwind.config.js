/** @type {import('tailwindcss').Config} */
// Club theme tokens (Denver Bulldogs): navy / burgundy / gold.
// Mobile-first: pages compose these tokens with Tailwind utilities; no custom CSS
// beyond the base layer in src/styles.css.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A1E3C',
          950: '#060F22',
          900: '#081426',
          800: '#0A1E3C',
          700: '#10294F',
          600: '#16345F',
          100: '#D7E0EE',
        },
        burgundy: {
          DEFAULT: '#7A1E2B',
          800: '#5C1220',
          700: '#7A1E2B',
          600: '#93283A',
          100: '#F0D9DD',
        },
        gold: {
          DEFAULT: '#E8A812',
          300: '#F7CE5B',
          400: '#F5B942',
          500: '#E8A812',
          600: '#C98A0B',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
