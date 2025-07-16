-- Добавляем уникальный индекс для комбинации room_id и telegram_id
-- Это позволит избежать дубликатов игроков в одной комнате
-- и обеспечит корректную работу upsert-логики в Server Actions.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_player_in_room'
    ) THEN
        ALTER TABLE public.players
        ADD CONSTRAINT unique_player_in_room UNIQUE (room_id, telegram_id);
        RAISE NOTICE 'Unique constraint unique_player_in_room added to public.players table.';
    ELSE
        RAISE NOTICE 'Unique constraint unique_player_in_room already exists on public.players table. Skipping.';
    END IF;
END
$$;
