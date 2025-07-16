-- Добавляем столбец username, если он не существует
ALTER TABLE players
ADD COLUMN IF NOT EXISTS username TEXT;

-- Добавляем столбец display_name, если он не существует
ALTER TABLE players
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Добавляем столбец avatar, если он не существует
ALTER TABLE players
ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Если столбцы уже существуют, но имеют другой тип, можно изменить их тип.
-- ВНИМАНИЕ: Изменение типа столбца с данными может привести к потере данных,
-- если новый тип несовместим с существующими данными.
-- Для TEXT это обычно безопасно, если предыдущий тип был VARCHAR или подобный.

-- Пример изменения типа (раскомментируйте, если уверены, что нужно изменить тип):
-- ALTER TABLE players
-- ALTER COLUMN username TYPE TEXT;

-- ALTER TABLE players
-- ALTER COLUMN display_name TYPE TEXT;

-- ALTER TABLE players
-- ALTER COLUMN avatar TYPE TEXT;

-- Убедимся, что столбцы могут быть NULL, так как username и photo_url могут отсутствовать у некоторых пользователей Telegram.
ALTER TABLE players
ALTER COLUMN username DROP NOT NULL;

ALTER TABLE players
ALTER COLUMN display_name DROP NOT NULL;

ALTER TABLE players
ALTER COLUMN avatar DROP NOT NULL;

-- Опционально: Если вы хотите установить значения по умолчанию для существующих NULL-записей
-- UPDATE players SET username = '' WHERE username IS NULL;
-- UPDATE players SET display_name = '' WHERE display_name IS NULL;
-- UPDATE players SET avatar = '' WHERE avatar IS NULL;

