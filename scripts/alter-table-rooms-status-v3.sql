-- scripts/alter-table-rooms-status-v3.sql

-- Добавляем новые значения в ENUM, если они еще не существуют
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type typ JOIN pg_namespace nsp ON typ.typnamespace = nsp.oid WHERE typname = 'room_status_enum' AND nsp.nspname = 'public') THEN
        CREATE TYPE public.room_status_enum AS ENUM ('waiting', 'countdown', 'spinning', 'finished', 'single_player');
    ELSE
        -- Если тип уже существует, проверяем и добавляем новые значения
        ALTER TYPE public.room_status_enum ADD VALUE 'single_player' AFTER 'waiting';
        ALTER TYPE public.room_status_enum ADD VALUE 'countdown' AFTER 'single_player';
        ALTER TYPE public.room_status_enum ADD VALUE 'spinning' AFTER 'countdown';
        ALTER TYPE public.room_status_enum ADD VALUE 'finished' AFTER 'spinning';
    END IF;
END $$;

-- Изменяем тип колонки status на новый ENUM
ALTER TABLE public.rooms
ALTER COLUMN status TYPE public.room_status_enum
USING status::public.room_status_enum;

-- Устанавливаем значение по умолчанию, если необходимо
ALTER TABLE public.rooms
ALTER COLUMN status SET DEFAULT 'waiting';
