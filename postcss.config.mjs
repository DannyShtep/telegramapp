import tailwindcss from '@tailwindcss/postcss'; // Импортируем сам плагин
import autoprefixer from 'autoprefixer';

export default {
  plugins: [
    tailwindcss, // Используем плагин напрямую, без вызова как функции
    autoprefixer,
  ],
}
