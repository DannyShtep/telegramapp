-- scripts/alter-table-types-v1.sql

-- Добавляем новые значения в ENUM, если они еще не существуют
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type typ JOIN pg_namespace nsp ON typ.typnamespace = nsp.oid WHERE typname = 'room_status_enum' AND nsp.nspname = 'public') THEN
        CREATE TYPE public.room_status_enum AS ENUM ('waiting', 'countdown', 'spinning', 'finished');
    ELSE
        -- Если тип уже существует, проверяем и добавляем новые значения
        ALTER TYPE public.room_status_enum ADD VALUE IF NOT EXISTS 'countdown';
        ALTER TYPE public.room_status_enum ADD VALUE IF NOT EXISTS 'spinning';
        ALTER TYPE public.room_status_enum ADD VALUE IF NOT EXISTS 'finished';
    END IF;
END $$;

-- Изменяем тип колонки status на новый ENUM
ALTER TABLE public.rooms
ALTER COLUMN status TYPE public.room_status_enum
USING status::public.room_status_enum;

-- Устанавливаем значение по умолчанию, если необходимо
ALTER TABLE public.rooms
ALTER COLUMN status SET DEFAULT 'waiting';
