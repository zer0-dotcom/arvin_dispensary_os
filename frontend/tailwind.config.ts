import type { Config } from 'tailwindcss';

/**
 * MiK // Retail Intelligence — dark-mode design system.
 * Background #0a0a0a, accent green #16a34a, tier colors red/amber/blue.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mik: {
          bg: '#0a0a0a',
          panel: '#111111',
          panel2: '#171717',
          border: '#262626',
          text: '#e5e5e5',
          muted: '#a3a3a3',
          faint: '#525252',
          accent: '#16a34a',
          accentSoft: '#16a34a1a',
        },
        tier: {
          t1: '#3b82f6',
          t1bg: '#3b82f61a',
          t2: '#f59e0b',
          t2bg: '#f59e0b1a',
          t3: '#dc2626',
          t3bg: '#dc26261a',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
