-- Добавляем столбец countdown_end_time в таблицу rooms
ALTER TABLE public.rooms
ADD COLUMN countdown_end_time TIMESTAMP WITH TIME ZONE;

-- Опционально: Обновляем существующие записи, если нужно установить начальное значение
-- UPDATE public.rooms
-- SET countdown_end_time = NOW() + INTERVAL '20 seconds'
-- WHERE status = 'countdown' AND countdown_end_time IS NULL;
