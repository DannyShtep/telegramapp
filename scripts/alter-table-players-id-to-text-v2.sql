-- scripts/alter-table-players-id-to-text-v2.sql

-- Изменяем тип колонки id в таблице players на TEXT
ALTER TABLE public.players
ALTER COLUMN id TYPE TEXT;
