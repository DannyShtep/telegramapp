import tailwindcss from '@tailwindcss/postcss'; // Импортируем новый плагин

export default {
  plugins: {
    [tailwindcss()]: {}, // Используем новый плагин
    autoprefixer: {},
  },
}
