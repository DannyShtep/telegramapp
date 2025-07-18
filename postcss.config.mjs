import tailwindcss from '@tailwindcss/postcss'; // Импортируем плагин
import autoprefixer from 'autoprefixer'; // Импортируем autoprefixer

export default {
  plugins: {
    tailwindcss: {}, // ИСПРАВЛЕНО: Используем объектный синтаксис для плагинов
    autoprefixer: {},
  },
}
