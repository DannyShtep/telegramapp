import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer'; // Убедитесь, что autoprefixer также импортируется

export default {
  plugins: [
    tailwindcss(), // Вызываем плагин как функцию
    autoprefixer,   // Просто ссылка на импортированный autoprefixer
  ],
}
