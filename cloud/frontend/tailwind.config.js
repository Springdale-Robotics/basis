/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand: deep spruce green. Everything status-colored (amber/red/etc.)
        // uses Tailwind defaults so usage states read conventionally.
        pine: {
          50: '#f0f7f3',
          100: '#dcece2',
          200: '#bcd9c8',
          300: '#8fbfa4',
          400: '#5e9f7e',
          500: '#3d8462',
          600: '#25684a',
          700: '#1d543d',
          800: '#194432',
          900: '#15382a',
          950: '#0a2018',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      maxWidth: {
        page: '72rem',
      },
    },
  },
  plugins: [],
};
