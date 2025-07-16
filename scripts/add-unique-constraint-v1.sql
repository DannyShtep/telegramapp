-- Добавляем уникальный индекс для комбинации room_id и telegram_id
-- Это позволит использовать upsert для обновления существующих игроков

-- Сначала удаляем дубликаты, если они есть
DELETE FROM players a USING players b 
WHERE a.id > b.id 
AND a.room_id = b.room_id 
AND a.telegram_id = b.telegram_id;

-- Добавляем уникальный индекс
CREATE UNIQUE INDEX IF NOT EXISTS players_room_telegram_unique 
ON players (room_id, telegram_id);
