-- Шаг 1: Удаляем существующее значение по умолчанию для столбца "status"
ALTER TABLE public.rooms
ALTER COLUMN status DROP DEFAULT;

-- Шаг 2: Изменяем тип столбца "status" на "room_status_type"
-- Используем USING для явного приведения существующих значений
ALTER TABLE public.rooms
ALTER COLUMN status TYPE public.room_status_type
USING status::public.room_status_type;

-- Шаг 3: Добавляем новое значение по умолчанию для столбца "status",
-- используя одно из допустимых значений ENUM
ALTER TABLE public.rooms
ALTER COLUMN status SET DEFAULT 'waiting';
