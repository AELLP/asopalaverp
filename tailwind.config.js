/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Supabase Brand & Accent Tokens
        primary: {
          DEFAULT: '#3ecf8e',
          deep: '#24b47e',
          soft: '#4ade80',
        },
        'on-primary': '#171717',
        // Supabase Surfaces (Dual Light & Dark Canvas Architecture)
        canvas: {
          DEFAULT: '#ffffff',
          soft: '#fafafa',
          night: '#000000',
          'night-soft': '#080808',
        },
        surface: {
          card: '#ffffff',
          'card-dark': '#1a1a1a',
          hover: '#f4f4f5',
          'hover-dark': '#202020',
          active: '#e4e4e7',
          'active-dark': '#282828',
          overlay: '#ffffff',
          'overlay-dark': '#1f1f1f',
        },
        // High-Contrast Showroom Text Tokens
        ink: {
          DEFAULT: '#171717',
          secondary: '#212121',
          mute: '#707070',
          'mute-2': '#707070',
          faint: '#b2b2b2',
          'on-primary': '#171717',
          'on-dark': '#ffffff',
        },
        // Crisp Hairline Borders
        hairline: {
          cool: '#ededed',
          DEFAULT: '#dfdfdf',
          strong: '#c7c7c7',
          control: '#a1a1a1',
          'cool-dark': '#242424',
          dark: '#2e2e2e',
          'strong-dark': '#383838',
          'control-dark': '#404040',
        },
        // Semantic Status Tokens
        status: {
          healthy: '#3ecf8e',
          warning: '#f59e0b',
          destructive: '#ef4444',
          info: '#3b82f6',
        },
        // Rare Accents
        accent: {
          purple: '#6b01c2',
          violet: '#644fc1',
          yellow: '#ffdb13',
        },
      },
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px', // Supabase Signature Button & Input Radius
        md: '8px',
        lg: '12px', // Primary Container & Card Radius
        xl: '16px', // Modals & Dialogs
        full: '9999px',
      },
      boxShadow: {
        'level-0': 'none',
        'level-1': '0 1px 3px rgba(0,0,0,0.06)',
        'level-2': '0 8px 24px rgba(0,0,0,0.08)',
        'level-3': '0 16px 48px rgba(0,0,0,0.12)',
      },
      letterSpacing: {
        'display-xxl': '-1.92px',
        'display-xl': '-1.44px',
        'display-lg': '-0.72px',
        'display-md': '-0.42px',
        tight: '-0.025em',
      },
    },
  },
  plugins: [],
}
