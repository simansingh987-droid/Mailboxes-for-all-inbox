/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      colors: {
        // Sampled from the AskCruz mark: deep navy body with silver hub.
        brand: {
          50: '#eef3f9', 100: '#dce5f1', 200: '#bacbe2', 300: '#8ea9cc', 400: '#6283b2',
          500: '#3e5d8a', 600: '#2d4a73', 700: '#203a5d', 800: '#142c4b', 900: '#0a2748', 950: '#061933',
        },
        silver: { 100: '#f1f3f6', 200: '#e1e5ea', 300: '#c7ccd4', 400: '#979fab', 500: '#727b88' },
        ink: { 950: '#070d18', 900: '#0b1322', 850: '#0f192b', 800: '#131f34', 700: '#1c2a42', 600: '#2a3953' },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(98,131,178,.25), 0 8px 30px -8px rgba(10,39,72,.45)',
        card: '0 1px 2px rgba(15,23,42,.06), 0 4px 16px -6px rgba(15,23,42,.10)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(16px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
};
