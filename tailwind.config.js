/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        panel: '#11171f',
        line: '#2a3441',
        'line-hi': '#3d4b5c',
        ink: '#e6edf3',
        'ink-dim': '#8b98a5',
        'ink-faint': '#5a6673',
        accent: '#2dd4a7',
        'accent-d': '#157878',
        bull: '#2dd4a7',
        bear: '#f0616d',
        warn: '#e3b341',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
