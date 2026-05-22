/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: '#FAF7F2',
        cream: '#F4EFE6',
        navy: '#0A2540',
        navyLight: '#1B3A5C',
        gold: '#C9A961',
        goldDark: '#A0813F',
        ink: '#1A1A1A',
        muted: '#6B7280',
        border: '#E5DFD3',
        accent: '#0F4C81',
        success: '#0F7B5F',
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 2px 8px rgba(10, 37, 64, 0.06)',
        medium: '0 4px 16px rgba(10, 37, 64, 0.08)',
        strong: '0 8px 32px rgba(10, 37, 64, 0.12)',
      },
    },
  },
  plugins: [],
};
