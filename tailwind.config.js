/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-marca, #125B18)',
        secondary: '#f9fff8ff',
        neutral: '#D1D1D1',
        dark: '#2B2B2B',
      }
    },
  },
  plugins: [],
}
